"""Publicação no Supabase: o que o hub validou vai para a camada trusted.
O painel web usa de três jeitos: a página "Qualidade dos dados" mostra a
validação; os cartões leem séries por dia (CONJUNTOS: horas do Machine Card,
apara da BASE_PROD, perda, aderência, m² por máquina, entregas, setup, laudos
e faturamento) que o Supabase soma no período, com as regras do BI
Indicadores Produção (sql/supabase/002_cartoes.sql e 005_banco.sql); e as
fotos do estado atual (FOTOS: máquinas agora, fila de programação, WIP,
carteira) vão inteiras a cada publicação. Tudo sai do banco da fábrica, menos
os lançamentos manuais (aderência diária, fardos e apara confirmada). A linha
do tempo usa os apontamentos do banco.

Quem publica é um usuário técnico do painel (scripts/criar_usuario_hub.py),
não a chave mestra do Supabase: a senha fica no Cofre de Credenciais do
Windows e a gravação só passa pela função public.hub_publicar, que confere se
o usuário está autorizado (trusted.escritores) e troca tudo numa transação.
Tudo por HTTPS, porta 443.

Só vai agregado e metadado: nenhum caminho de arquivo, nome de operador ou
de cliente. Mensagens de aviso passam por _limpar antes de sair do PC. Do
último dia vão os eventos (máquina, código, início, fim, OP) pra linha do
tempo, sem observação nem operador.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import keyring
import polars as pl
import requests

from hub.caminhos import RAIZ
from hub.db import tabela_existe
from hub.relatorio import preencher_correcao

SERVICO_COFRE = "gualapack-hub"
CONFIG_PAINEL = RAIZ.parent / "demo" / "supabase-config.js"


class PublicacaoFalhou(Exception):
    pass


def config_supabase(caminho: Path = CONFIG_PAINEL) -> dict:
    """Endereço, chave pública e função de cadastro: os mesmos do painel
    (demo/supabase-config.js), que são públicos por natureza."""
    texto = caminho.read_text(encoding="utf-8")
    achar = lambda chave: (re.search(rf'{chave}\s*:\s*"([^"]+)"', texto) or [None, None])[1]
    cfg = {"url": achar("url"), "anon_key": achar("anonKey"), "cadastro_url": achar("registerFunctionUrl")}
    if not cfg["url"] or not cfg["anon_key"]:
        raise PublicacaoFalhou(f"não achei url/anonKey em {caminho.name}")
    return cfg


def senha_do_cofre(email: str) -> str | None:
    return keyring.get_password(SERVICO_COFRE, email)


# -- pacote -------------------------------------------------------------------------
def _iso(v):
    if isinstance(v, datetime):
        return v.astimezone().isoformat()  # hora local do PC, com fuso
    if isinstance(v, date):
        return v.isoformat()
    return v


def _hora_fabrica(v: datetime | None) -> str | None:
    """Hora de apontamento como a fábrica anotou, sem fuso (coluna timestamp)."""
    return v.replace(microsecond=0).isoformat() if v else None


def _num(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return float(v)


def _limpar(texto: str | None, pasta_entrada: Path | None) -> str | None:
    """Tira caminho local de mensagem que vai pra nuvem."""
    if not texto:
        return texto
    for caminho in (pasta_entrada, Path.home()):
        if caminho:
            texto = texto.replace(str(caminho), "…")
    return texto


def montar_pacote(con: duckdb.DuckDBPyConnection, run_id: int, cfg: dict) -> dict:
    execucao = con.execute("select id, started_at, finished_at, status from processing_runs where id = ?",
                           [run_id]).fetchone()

    fontes = [
        {"fonte": f[0], "tipo": f[1], "descricao": f[2], "dono": f[3], "status": f[4],
         "lido_em": _iso(f[5]), "arquivo_salvo_em": _iso(f[6]), "dado_ate": _iso(f[7]),
         "linhas": f[8], "frescor_dias": f[9]}
        for f in con.execute(
            """select v.fonte, v.tipo, s.descricao, v.dono, v.status, v.lido_em, v.arquivo_salvo_em,
                      v.dado_ate, v.linhas, v.frescor_dias
               from v_saude_fonte v join sources s on s.id = v.fonte order by v.fonte""").fetchall()]

    indicadores = []
    for ind in cfg["indicadores"]:
        comparadas = [m["fonte"] for m in ind["medicoes"] if m["fonte"] != ind["fonte_oficial"]]
        indicadores.append({
            "codigo": ind["codigo"], "versao": ind["versao"], "nome": ind["nome"], "unidade": ind["unidade"],
            "grao": ind["grao"], "definicao": " ".join(ind["definicao"].split()),
            "fonte_oficial": ind["fonte_oficial"], "fontes_comparadas": ",".join(comparadas) or None,
            "tolerancia_abs": ind.get("tolerancia_abs"), "tolerancia_pct": ind.get("tolerancia_pct"),
            "status_definicao": ind.get("status_definicao"),
            "notas": " ".join(ind["notas"].split()) if ind.get("notas") else None,
        })

    validacao = []
    for v in con.execute(
            """select v.indicador, v.periodo, v.recorte, v.fonte_oficial, v.valor_oficial,
                      coalesce(v.fonte_comparada, ''), v.valor_comparado, v.dif_abs, v.dif_pct,
                      v.status, v.motivo, i.correcao, i.unidade
               from validation_results v
               join indicators i on i.codigo = v.indicador
                                and i.versao = (select max(versao) from indicators where codigo = v.indicador)
               where v.run_id = ?""", [run_id]).fetchall():
        correcao = preencher_correcao(v[11], v[2], v[1], v[4], v[6], v[12]) if v[9] == "divergente" else None
        validacao.append({
            "indicador": v[0], "periodo": _iso(v[1]), "recorte": v[2], "fonte_oficial": v[3],
            "valor_oficial": _num(v[4]), "fonte_comparada": v[5], "valor_comparado": _num(v[6]),
            "dif_abs": _num(v[7]), "dif_pct": _num(v[8]), "status": v[9], "motivo": v[10],
            "correcao": correcao,
        })

    avisos = [
        {"gravidade": a[0], "fonte": a[1], "codigo": a[2], "mensagem": _limpar(a[3], cfg.get("pasta_entrada"))}
        for a in con.execute("select gravidade, source_id, codigo, mensagem from errors where run_id = ? "
                             "and codigo <> 'publicacao_falhou'", [run_id]).fetchall()]

    pacote = {
        "execucao": {"id": execucao[0], "iniciada_em": _iso(execucao[1]),
                     "terminada_em": _iso(execucao[2]), "status": execucao[3]},
        "fontes": fontes, "indicadores": indicadores, "validacao": validacao, "avisos": avisos,
    }
    if tabela_existe(con, "raw.banco__apontamentos"):
        pacote["codigos"] = codigos(con)
        pacote["ultimo_dia"] = ultimo_dia(con)
    if tabela_existe(con, "clean.base_prod") and tabela_existe(con, "clean.apara_confirmada_mes"):
        pacote["apara_mes"] = apara_mes(con)
    for chave, (tabela, consulta) in FOTOS.items():
        if tabela_existe(con, tabela):
            pacote[chave] = _linhas(con, consulta)
    return pacote


def _linhas(con: duckdb.DuckDBPyConnection, consulta: str) -> list[dict]:
    """Linhas de uma consulta prontas pro JSON: data "2026-10-05", data e hora
    "2026-10-05T12:40:00" (hora da fábrica, sem fuso), NaN vira null."""
    df = con.execute(consulta).pl()
    df = df.with_columns(
        [pl.col(c).dt.strftime("%Y-%m-%d") for c, tipo in df.schema.items() if tipo == pl.Date]
        + [pl.col(c).dt.strftime("%Y-%m-%dT%H:%M:%S") for c, tipo in df.schema.items() if isinstance(tipo, pl.Datetime)]
        + [pl.col(c).fill_nan(None) for c, tipo in df.schema.items() if tipo in (pl.Float32, pl.Float64)])
    return df.to_dicts()


# -- códigos e linha do tempo, do banco ----------------------------------------------
_COD = """case when length(cast(try_cast(cod_apont as integer) as varchar)) = 1
                then '0' || cast(try_cast(cod_apont as integer) as varchar)
                else cast(try_cast(cod_apont as integer) as varchar) end"""


def codigos(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Cada código de apontamento do banco com a descrição do banco e a classe
    da tabela-padrão. Código sem cadastro vai como SEM CLASSIFICACAO."""
    return [{"cod": c[0], "descricao": c[1], "classe": c[2]} for c in con.execute(
        f"""with b as (   -- mesmo zero à esquerda do clean (lpad do DuckDB corta texto)
             select {_COD} as cod, any_value(trim(cod_desc)) as descricao
             from raw.banco__apontamentos where try_cast(cod_apont as integer) is not null group by 1)
           select b.cod, b.descricao, coalesce(c.classe, 'SEM CLASSIFICACAO')
           from b left join clean.classificacao c on c.cod = b.cod
           order by b.cod""").fetchall()]


def ultimo_dia(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Eventos do último dia de produção do banco, pra linha do tempo das
    máquinas. O evento ainda em andamento (fim vazio, "data zero") vai até a
    hora do dado mais novo; registro instantâneo (fim = início) fica de fora."""
    return [{"maquina": e[0], "cod_apont": e[1], "hora_inicio": _hora_fabrica(e[2]),
             "hora_fim": _hora_fabrica(e[3]), "num_ordem": e[4]} for e in con.execute(
        f"""with a as (select * from raw.banco__apontamentos
                        where cod_recurso is not null and hora_inicio > timestamp '2000-01-01'
                          and hora_inicio < current_date + interval 2 day),   -- data errada no futuro não conta
                ref as (select max(cast(dt_producao as date)) filter (where dt_producao < current_date + interval 2 day) as dia,
                               max(dt_inclusao) filter (where dt_inclusao < current_date + interval 2 day) as agora from a)
           select upper(trim(cod_recurso)), {_COD}, hora_inicio,
                  case when hora_fim is null or hora_fim < timestamp '1901-01-01'
                       then greatest(ref.agora, hora_inicio) else hora_fim end,
                  nullif(trim(num_ordem), '')
           from a, ref
           where cast(a.dt_producao as date) = ref.dia
             and (hora_fim is null or hora_fim < timestamp '1901-01-01' or hora_fim > hora_inicio)
           order by 1, 3""").fetchall()]


# Linha do tempo: os eventos de cada um dos últimos dias de produção. O dia de
# produção vai das 06:00 às 06:00 do dia seguinte (o turno da noite, de 00h às
# 06h, ainda é do dia anterior no banco). Entra no dia todo evento que toca essa
# janela, até o que começou no dia anterior e seguia aberto (fica nos dois).
DIAS_LINHA_DO_TEMPO = 14
INICIO_DIA_PRODUCAO = 6


def eventos_por_dia(con: duckdb.DuckDBPyConnection) -> dict[date, list[dict]]:
    """{dia de produção: eventos}, dos últimos DIAS_LINHA_DO_TEMPO dias com
    apontamento. Evento em andamento vai até o dado mais novo; registro
    instantâneo (fim = início) fica de fora, como no ultimo_dia."""
    if not tabela_existe(con, "raw.banco__apontamentos"):
        return {}
    linhas = con.execute(
        f"""with a as (select * from raw.banco__apontamentos
                        where cod_recurso is not null and hora_inicio > timestamp '2000-01-01'
                          and hora_inicio < current_date + interval 2 day),
                ref as (select max(dt_inclusao) filter (where dt_inclusao < current_date + interval 2 day) as agora from a),
                dias as (select distinct cast(dt_producao as date) as dia from a
                         where dt_producao < current_date + interval 2 day order by 1 desc limit {DIAS_LINHA_DO_TEMPO}),
                ev as (select upper(trim(cod_recurso)) as maquina, {_COD} as cod_apont, hora_inicio,
                              case when hora_fim is null or hora_fim < timestamp '1901-01-01'
                                   then greatest(ref.agora, hora_inicio) else hora_fim end as hora_fim,
                              nullif(trim(num_ordem), '') as num_ordem
                       from a, ref
                       where (hora_fim is null or hora_fim < timestamp '1901-01-01' or hora_fim > hora_inicio)
                         and cast(a.dt_producao as date) >= (select min(dia) from dias) - 3)
           select d.dia, ev.maquina, ev.cod_apont, ev.hora_inicio, ev.hora_fim, ev.num_ordem
           from dias d join ev
             on ev.hora_inicio < d.dia + interval {24 + INICIO_DIA_PRODUCAO} hour
            and ev.hora_fim > d.dia + interval {INICIO_DIA_PRODUCAO} hour
           order by 1, 2, 4, 5""").fetchall()
    dias: dict[date, list[dict]] = {}
    for dia, maquina, cod, ini, fim, op in linhas:
        dias.setdefault(dia, []).append({"dia": dia.isoformat(), "maquina": maquina, "cod_apont": cod,
                                         "hora_inicio": _hora_fabrica(ini), "hora_fim": _hora_fabrica(fim),
                                         "num_ordem": op})
    return dias


# Séries por dia que o painel soma no período escolhido (002_cartoes.sql).
# Cada uma: tabela de onde sai e a consulta das linhas, com as colunas da
# tabela trusted de mesmo nome. Vão um mês por vez, e só o mês que mudou.
CONJUNTOS: dict[str, tuple[str, str]] = {
    # TMR, velocidade e paradas: tabela Horas do Machine Card (regras do BI)
    "horas_maquina_dia": ("clean.machine_card", """
        select dia, maquina, cod_apont, max(cod_desc) as cod_desc, coalesce(classe, '') as classe,
               round(sum(coalesce(horas, 0)), 6) as horas, round(sum(coalesce(metros, 0)), 3) as metros
        from clean.machine_card group by dia, maquina, cod_apont, coalesce(classe, '')"""),
    # apara apontada, OPs e classificações: BASE_PROD do Base Aparas
    "apara_dia": ("clean.base_prod", """
        select dia, maquina, maquina_real, num_ordem, descricao, grupos,
               round(peso_bruto, 3) as peso_bruto, round(refugo, 3) as refugo
        from clean.base_prod"""),
    # perda por motivo e por máquina: BASE_DETALHE do Base Aparas (código 40)
    "perda_dia": ("clean.perda", """
        select dia, maquina, coalesce(num_ordem, '') as num_ordem, coalesce(tipo, '') as tipo,
               round(sum(kg), 3) as kg
        from clean.perda group by all"""),
    # aderência ao programado: ADERENCIA_BI da Aderência Semanal
    "aderencia_dia": ("clean.aderencia", """
        select dia, maquina, coalesce(num_ordem, '') as num_ordem,
               round(sum(planejado), 3) as planejado, round(sum(produzido), 3) as produzido
        from clean.aderencia group by all"""),
    # produtividade (m² por hora de máquina): a consulta "Produção" do Machine Card, refeita do banco
    "m2_maquina_dia": ("clean.producao_metros", """
        select dia, maquina_painel as maquina,
               round(sum(coalesce(m2, 0)), 3) as m2, round(sum(coalesce(horas, 0)), 6) as horas
        from clean.producao_metros group by all"""),
    # --- 005_banco.sql: o que o painel ganhou com a leitura direta do banco ---
    # entregas no prazo: a classificação do PCP por item faturado
    "entrega_dia": ("clean.entrega_dia", """
        select dia, status, cliente, itens, notas from clean.entrega_dia"""),
    # setup programado x real por máquina
    "setup_dia": ("clean.setup_dia", """
        select dia, maquina, atividades, round(min_programado, 3) as min_programado,
               round(min_real, 3) as min_real, acima_do_programado
        from clean.setup_dia"""),
    # laudos do CQ por status
    "laudo_dia": ("clean.laudo_dia", """
        select dia, status, laudos, analises from clean.laudo_dia"""),
    # faturamento de produto acabado (kg = m² × gramatura ÷ 1000)
    "faturamento_dia": ("clean.faturamento_dia", """
        select dia, cliente, notas, itens, round(m2, 3) as m2, round(kg, 3) as kg from clean.faturamento_dia"""),
    # --- 006_tempo_aderencia.sql ---
    # planejado x realizado por máquina, como a página Ad. Plan Mensal do BI
    "plano_dia": ("clean.plano_dia", """
        select dia, maquina, round(planejado, 3) as planejado, round(realizado, 3) as realizado
        from clean.plano_dia"""),
}
# Conjuntos que só existem a partir do 005_banco.sql: sem ele, o Supabase não
# conhece o conjunto e eles ficam de fora, com um aviso (o resto publica normal).
CONJUNTOS_005 = {"entrega_dia", "setup_dia", "laudo_dia", "faturamento_dia"}
# ... e a partir do 006_tempo_aderencia.sql (o evento_dia vai um dia por vez)
CONJUNTOS_006 = {"plano_dia", "evento_dia"}

# Fotos do estado atual: vão inteiras no pacote, a cada publicação (005_banco.sql).
FOTOS: dict[str, tuple[str, str]] = {
    "agora": ("clean.maquina_agora", "select * from clean.maquina_agora order by maquina"),
    "programacao": ("clean.programacao", """
        select maquina, posicao, num_ordem, cliente, produto, atividade, situacao, ini_plan, fim_plan, entrega,
               qtd_planejada, qtd_produzida, saldo
        from clean.programacao order by maquina, posicao"""),
    "wip": ("clean.wip", "select * from clean.wip order by etapa, local, cliente, idade"),
    "carteira": ("clean.carteira_aberta", """
        select * from clean.carteira_aberta
        order by coalesce(entrega_pcp, entrega_cliente) nulls last, num_pedido, item"""),
    "carteira_mes": ("clean.carteira_mes", "select * from clean.carteira_mes order by mes"),
}


def assinaturas(con: duckdb.DuckDBPyConnection, conjunto: str) -> dict[date, str]:
    """md5 de cada mês da série: só vai pro Supabase o mês que mudou."""
    tabela, consulta = CONJUNTOS[conjunto]
    if not tabela_existe(con, tabela):
        return {}
    return dict(con.execute(
        f"""with q as ({consulta})
            select date_trunc('month', dia)::date, md5(string_agg(q::varchar, ';' order by q::varchar))
            from q group by 1""").fetchall())


def linhas_do_mes(con: duckdb.DuckDBPyConnection, conjunto: str, mes: date) -> list[dict]:
    _, consulta = CONJUNTOS[conjunto]
    df = con.execute(f"with q as ({consulta}) select * from q where date_trunc('month', dia) = ? order by all",
                     [mes]).df()
    linhas = json.loads(df.to_json(orient="records", date_format="iso"))
    for linha in linhas:  # "2026-08-01T00:00:00.000" -> "2026-08-01"
        linha["dia"] = linha["dia"][:10]
    return linhas


def apara_mes(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Série mensal do gráfico de apara: refugo e peso bruto das REBs
    (BASE_PROD) e scrap da balança (Refugo Aparas). O painel faz as contas
    do BI com isso (v_hub_apara_mensal).

    volume_jgr e scrap_jgr: as colunas da própria Refugo Aparas (Conta Refugo).
    A apara confirmada do painel é a "% JGR" da planilha, scrap_jgr ÷
    (volume_jgr + scrap_jgr): o número que importa pro time (decisão do dono
    em 08/10/2026). A VOLUME JGR vai só até o último dia pesado, então o mês
    em andamento não divide o fardo de ontem pela produção de hoje."""
    return [{"mes": r[0].isoformat(), "refugo": _num(r[1]), "peso_bruto_rebs": _num(r[2]),
             "scrap_total": _num(r[3]), "volume_jgr": _num(r[4]), "scrap_jgr": _num(r[5])} for r in con.execute(
        """with b as (
             select date_trunc('month', dia)::date as mes, sum(refugo) as refugo,
                    sum(peso_bruto) filter (where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10'))
                      as pb_rebs
             from clean.base_prod group by 1)
           select coalesce(b.mes, c.mes), b.refugo, b.pb_rebs, c.scrap_total, c.volume_jgr, c.scrap_jgr
           from b full join clean.apara_confirmada_mes c on c.mes = b.mes
           order by 1""").fetchall()]


def _fim_do_mes(mes: date) -> date:
    return (mes.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


# -- envio ----------------------------------------------------------------------------
def publicar(con: duckdb.DuckDBPyConnection, run_id: int, cfg: dict, republicar: bool = False) -> str:
    """Devolve um resumo pro log. Levanta PublicacaoFalhou se o Supabase recusar.
    republicar=True reenvia as horas de todos os meses, não só dos que mudaram."""
    pub = cfg.get("publicacao") or {}
    if not pub.get("ativa"):
        return "desligada (publicacao.ativa no fontes.local.yaml)"
    senha = senha_do_cofre(pub["email"])
    if not senha:
        return "sem usuário técnico no Cofre do Windows (rode scripts/criar_usuario_hub.py)"
    supa = config_supabase()
    pacote = montar_pacote(con, run_id, cfg)

    sessao = requests.Session()
    login = sessao.post(f"{supa['url']}/auth/v1/token?grant_type=password", timeout=30,
                        headers={"apikey": supa["anon_key"]},
                        json={"email": pub["email"], "password": senha})
    if login.status_code != 200:
        raise PublicacaoFalhou(f"login do usuário técnico recusado ({login.status_code})")
    cabecalho = {"apikey": supa["anon_key"], "Authorization": f"Bearer {login.json()['access_token']}",
                 "Content-Type": "application/json"}

    def enviar(dados: dict) -> dict:
        resposta = sessao.post(f"{supa['url']}/rest/v1/rpc/hub_publicar", timeout=180, headers=cabecalho,
                               data=json.dumps({"dados": dados}, ensure_ascii=False).encode("utf-8"))
        if resposta.status_code == 404:
            raise PublicacaoFalhou("a função hub_publicar não existe no Supabase: "
                                   "rode hub/sql/supabase/001_trusted.sql")
        if resposta.status_code in (401, 403):
            raise PublicacaoFalhou("o usuário técnico não está autorizado a publicar (trusted.escritores)")
        if resposta.status_code >= 300:
            raise PublicacaoFalhou(f"o Supabase recusou a publicação ({resposta.status_code}): "
                                   f"{resposta.text[:300]}")
        return resposta.json() or {}

    enviar(pacote)

    # Séries por dia, um mês por chamada (cada mês troca inteiro, numa
    # transação). O Supabase devolve quantas linhas gravou: se não bater (ex.:
    # 002_cartoes.sql ainda não aplicado, a função antiga ignora o conjunto),
    # o mês não fica marcado e vai de novo na próxima.
    if republicar:
        con.execute("delete from publicacao_mes")
    ja_foi = {(c, m): a for c, m, a in con.execute("select conjunto, mes, assinatura from publicacao_mes").fetchall()}
    enviados, sem_005, sem_006 = {}, [], []
    for conjunto in CONJUNTOS:
        for mes, assinatura in sorted(assinaturas(con, conjunto).items()):
            if ja_foi.get((conjunto, mes)) == assinatura:
                continue
            linhas = linhas_do_mes(con, conjunto, mes)
            try:
                resposta = enviar({"conjunto": conjunto, "de": mes.isoformat(), "ate": _fim_do_mes(mes).isoformat(),
                                   "linhas": linhas})
            except PublicacaoFalhou as e:
                if conjunto in CONJUNTOS_005 | CONJUNTOS_006 and "conjunto desconhecido" in str(e):
                    (sem_005 if conjunto in CONJUNTOS_005 else sem_006).append(conjunto)
                    break  # o Supabase ainda não tem o SQL: os outros meses deste conjunto também não entram
                raise
            if resposta.get("linhas") != len(linhas):
                raise PublicacaoFalhou(f"o Supabase não gravou '{conjunto}' ({resposta}): falta rodar "
                                       "hub/sql/supabase/002_cartoes.sql no SQL Editor e depois 'uv run hub publicar'")
            con.execute("""insert into publicacao_mes values (?, ?, ?, current_timestamp)
                           on conflict (conjunto, mes) do update set assinatura = excluded.assinatura,
                                                                     publicado_em = excluded.publicado_em""",
                        [conjunto, mes, assinatura])
            enviados[conjunto] = enviados.get(conjunto, 0) + 1

    # Linha do tempo: um dia de produção por chamada, só o dia que mudou (o de
    # hoje muda a cada rodada; os anteriores, quase nunca).
    dias_enviados = 0
    for dia, linhas in sorted(eventos_por_dia(con).items()):
        assinatura = hashlib.md5(json.dumps(linhas, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
        if ja_foi.get(("evento_dia", dia)) == assinatura:
            continue
        try:
            resposta = enviar({"conjunto": "evento_dia", "de": dia.isoformat(), "ate": dia.isoformat(), "linhas": linhas})
        except PublicacaoFalhou as e:
            if "conjunto desconhecido" in str(e):
                sem_006.append("evento_dia")
                break
            raise
        if resposta.get("linhas") != len(linhas):
            raise PublicacaoFalhou(f"o Supabase não gravou os eventos de {dia} ({resposta})")
        con.execute("""insert into publicacao_mes values (?, ?, ?, current_timestamp)
                       on conflict (conjunto, mes) do update set assinatura = excluded.assinatura,
                                                                 publicado_em = excluded.publicado_em""",
                    ["evento_dia", dia, assinatura])
        dias_enviados += 1

    series = ", ".join(f"{c} {n} mês(es)" for c, n in enviados.items())
    if dias_enviados:
        series = (series + ", " if series else "") + f"linha do tempo {dias_enviados} dia(s)"
    series = series or "nenhuma série mudou"
    falta = (f"; sem o 005_banco.sql no Supabase, ficaram de fora: {', '.join(sem_005)}" if sem_005 else "")
    falta += (f"; sem o 006_tempo_aderencia.sql no Supabase, ficaram de fora: {', '.join(sem_006)}" if sem_006 else "")
    return (f"publicado: {len(pacote['validacao'])} validações, {len(pacote['fontes'])} fontes, "
            f"{len(pacote['avisos'])} avisos, {len(pacote.get('ultimo_dia', []))} eventos do último dia; {series}{falta}")
