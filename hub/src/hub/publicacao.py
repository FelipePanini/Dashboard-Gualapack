"""Publicação no Supabase: o que o hub validou vai para a camada trusted.
O painel web usa de dois jeitos: a página "Qualidade dos dados" mostra a
validação, e os cartões de TMR, paradas e linha do tempo leem as horas por
máquina/dia/código tiradas dos apontamentos do BI (a base completa — a Base
Apontamento do Excel perde as paradas sem OP).

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

import json
import math
import re
from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb
import keyring
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
    if tabela_existe(con, "clean.pbi_apontamento"):
        pacote["codigos"] = codigos(con)
        pacote["ultimo_dia"] = ultimo_dia(con)
    return pacote


# -- horas do BI pros cartões do painel -------------------------------------------
def codigos(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Cada código de apontamento do BI com a descrição do BI e a classe do
    cadastro oficial. Código sem cadastro vai como SEM CLASSIFICACAO."""
    return [{"cod": c[0], "descricao": c[1], "classe": c[2]} for c in con.execute(
        """with bi as (   -- mesmo zero à esquerda do clean (lpad do DuckDB corta texto)
             select case when length(cast(cod_apont as varchar)) = 1 then '0' || cast(cod_apont as varchar)
                         else cast(cod_apont as varchar) end as cod,
                    any_value(cast(cod_desc as varchar)) as descricao
             from raw.pbi__apontamentos where cod_apont is not null group by 1)
           select bi.cod, bi.descricao, coalesce(c.classe, 'SEM CLASSIFICACAO')
           from bi left join clean.classificacao c on c.cod = bi.cod
           order by bi.cod""").fetchall()]


def ultimo_dia(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Eventos do último dia do BI, pra linha do tempo das máquinas."""
    return [{"maquina": e[0], "cod_apont": e[1], "hora_inicio": _hora_fabrica(e[2]),
             "hora_fim": _hora_fabrica(e[3]), "num_ordem": e[4]} for e in con.execute(
        """select upper(trim(cast(cod_recurso as varchar))),
                  case when length(cast(cod_apont as varchar)) = 1 then '0' || cast(cod_apont as varchar)
                       else cast(cod_apont as varchar) end,
                  cast(hora_inicio as timestamp), cast(hora_fim as timestamp), cast(num_ordem as varchar)
           from raw.pbi__apontamentos
           where cast(dt_producao as date) = (select max(dia) from clean.pbi_apontamento)
             and cod_recurso is not null and hora_inicio is not null and hora_fim is not null
           order by 1, 3""").fetchall()]


def assinaturas_horas(con: duckdb.DuckDBPyConnection) -> dict[date, str]:
    """md5 das horas de cada mês: só vai pro Supabase o mês que mudou."""
    if not tabela_existe(con, "clean.pbi_apontamento"):
        return {}
    return dict(con.execute(
        """select date_trunc('month', dia)::date,
                  md5(string_agg(concat_ws('|', dia, maquina, cod_apont, round(horas, 6)), ';'
                                 order by dia, maquina, cod_apont))
           from (select dia, maquina, cod_apont, sum(horas) as horas from clean.pbi_apontamento
                 where horas is not null group by all)
           group by 1""").fetchall())


def horas_do_mes(con: duckdb.DuckDBPyConnection, mes: date) -> list[dict]:
    return [{"dia": h[0].isoformat(), "maquina": h[1], "cod_apont": h[2], "horas": round(float(h[3]), 6)}
            for h in con.execute(
                """select dia, maquina, cod_apont, sum(horas) from clean.pbi_apontamento
                   where horas is not null and date_trunc('month', dia) = ?
                   group by all order by all""", [mes]).fetchall()]


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

    def enviar(dados: dict) -> None:
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

    enviar(pacote)

    # Horas por máquina/dia/código, um mês por chamada (cada mês troca inteiro,
    # numa transação). Mês que falhar não fica marcado e vai na próxima.
    if republicar:
        con.execute("delete from publicacao_horas")
    ja_foi = dict(con.execute("select mes, assinatura from publicacao_horas").fetchall())
    meses = 0
    for mes, assinatura in sorted(assinaturas_horas(con).items()):
        if ja_foi.get(mes) == assinatura:
            continue
        enviar({"horas_de": mes.isoformat(), "horas_ate": _fim_do_mes(mes).isoformat(),
                "horas_maquina_dia": horas_do_mes(con, mes)})
        con.execute("""insert into publicacao_horas values (?, ?, current_timestamp)
                       on conflict (mes) do update set assinatura = excluded.assinatura,
                                                       publicado_em = excluded.publicado_em""", [mes, assinatura])
        meses += 1
    return (f"publicado: {len(pacote['validacao'])} validações, {len(pacote['fontes'])} fontes, "
            f"{len(pacote['avisos'])} avisos, {len(pacote.get('ultimo_dia', []))} eventos do último dia, "
            f"horas de {meses} mês(es)")
