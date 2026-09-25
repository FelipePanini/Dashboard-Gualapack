"""Publicação: o pacote que vai pro Supabase (sem rede nos testes)."""
import json
from datetime import date
from pathlib import Path

import pytest

from hub import db, publicacao


def _con_com_dados(pasta: Path):
    con = db.conectar(":memory:")
    con.execute("insert into processing_runs (gatilho, status) values ('teste', 'ok')")
    con.execute("insert into sources (id, tipo, descricao, dono, frescor_dias) values "
                "('graficos.tmr', 'excel_bloco', 'TMR da planilha', 'Produção', 0)")
    con.execute("""insert into files (source_id, run_id, caminho, sha256, status, dado_ate, linhas)
                   values ('graficos.tmr', 1, ?, 'abc', 'novo', null, 98)""", [str(pasta / "Graficos Tendência.xlsx")])
    con.execute("""insert into indicators (codigo, versao, nome, unidade, grao, definicao, regra_sql, fonte_oficial,
                     correcao) values ('TMR_PCT', 1, 'TMR', 'pct', 'mes', 'def', 'x.sql', 'graficos.tmr',
                     'aba TMR - {recorte} › linha {mes} = {valor_comparado}')""")
    con.execute("""insert into validation_results values
                   (1, 'TMR_PCT', '2026-01-01', 'Flexo', 'graficos.tmr', 37.7, 'hub.calculo', 41.76, 4.06, 0.108, 'divergente', 'acima'),
                   (1, 'TMR_PCT', '2026-03-01', 'Flexo', 'graficos.tmr', 35.9, 'hub.calculo', 35.9, 0, 0, 'validado', 'ok')""")
    con.execute("insert into errors (run_id, source_id, gravidade, codigo, mensagem) values (1, null, 'aviso', 'x', ?)",
                [f"0 arquivo(s) em {pasta}\\Indicadores"])
    return con


def test_pacote(tmp_path):
    con = _con_com_dados(tmp_path)
    cfg = {"pasta_entrada": tmp_path, "indicadores": [{
        "codigo": "TMR_PCT", "versao": 1, "nome": "TMR", "unidade": "pct", "grao": "mes",
        "definicao": "Horas  produzindo\n  ÷ horas", "fonte_oficial": "graficos.tmr",
        "medicoes": [{"fonte": "graficos.tmr"}, {"fonte": "hub.calculo"}]}]}
    pacote = publicacao.montar_pacote(con, 1, cfg)

    json.dumps(pacote)  # precisa virar JSON sem conversor especial
    assert pacote["execucao"]["id"] == 1 and pacote["execucao"]["status"] == "ok"
    assert pacote["indicadores"][0]["definicao"] == "Horas produzindo ÷ horas"
    assert pacote["indicadores"][0]["fontes_comparadas"] == "hub.calculo"
    por_mes = {v["periodo"]: v for v in pacote["validacao"]}
    assert por_mes["2026-01-01"]["correcao"] == "aba TMR - Flexo › linha Janeiro = 41,76%"
    assert por_mes["2026-03-01"]["correcao"] is None               # só divergência ganha instrução
    assert pacote["fontes"][0]["fonte"] == "graficos.tmr"
    assert "caminho" not in pacote["fontes"][0]                     # caminho de arquivo não sai do PC
    assert str(tmp_path) not in pacote["avisos"][0]["mensagem"]


def test_config_supabase_le_o_arquivo_do_painel(tmp_path):
    js = tmp_path / "supabase-config.js"
    js.write_text('window.SUPABASE_CONFIG = {\n  url: "https://x.supabase.co",\n  anonKey: "abc",\n'
                  '  registerFunctionUrl: "https://x.supabase.co/functions/v1/super-action",\n};', encoding="utf-8")
    cfg = publicacao.config_supabase(js)
    assert cfg == {"url": "https://x.supabase.co", "anon_key": "abc",
                   "cadastro_url": "https://x.supabase.co/functions/v1/super-action"}


def _com_apontamentos_bi(con):
    con.execute("create schema if not exists raw; create schema if not exists clean")
    con.execute("""create table raw.pbi__apontamentos as select * from (values
        ('R18', '1',  '01 - Setup',      date '2026-08-31', timestamp '2026-08-31 06:00:00', timestamp '2026-08-31 07:00:00', '10'),
        ('R18', '20', '20 - Produzindo', date '2026-09-02', timestamp '2026-09-02 06:00:00', timestamp '2026-09-02 09:59:59.999999', '10'),
        ('R18', '99', '99 - Fim Turno',  date '2026-09-02', timestamp '2026-09-02 10:00:00', timestamp '2026-09-02 10:30:00', null),
        ('L04', '20', '20 - Produzindo', date '2026-09-02', timestamp '2026-09-02 06:00:00', timestamp '2026-09-02 08:00:00', '11')
      ) t(cod_recurso, cod_apont, cod_desc, dt_producao, hora_inicio, hora_fim, num_ordem)""")
    con.execute("""create table clean.pbi_apontamento as select * from (values
        (date '2026-08-31', 'R18', '01', 1.0), (date '2026-09-02', 'R18', '20', 2.5),
        (date '2026-09-02', 'R18', '20', 1.5), (date '2026-09-02', 'R18', '99', 0.5),
        (date '2026-09-02', 'L04', '20', 2.0)) t(dia, maquina, cod_apont, horas)""")
    con.execute("""create table clean.classificacao as select * from (values
        ('01', 'SETUP'), ('20', 'PRODUZINDO')) t(cod, classe)""")
    # tabela Horas do Machine Card, já limpa (110_machine_card.sql)
    con.execute("""create table clean.machine_card as select * from (values
        (date '2026-08-31', 'R18', '01', '01 - Setup',      'SETUP',      1.0, 0.0,    '10'),
        (date '2026-09-02', 'R18', '20', '20 - Produzindo', 'PRODUZINDO', 2.5, 3000.0, '10'),
        (date '2026-09-02', 'R18', '20', '20 - Produzindo', 'PRODUZINDO', 1.5, 1000.0, '10'),
        (date '2026-09-02', 'R18', '77', '77 - Sem classe', null,         0.5, 0.0,    null),
        (date '2026-09-02', 'L04', '20', '20 - Produzindo', 'PRODUZINDO', 2.0, 900.0,  '11')
      ) t(dia, maquina, cod_apont, cod_desc, classe, horas, metros, num_ordem)""")
    con.execute("""create table clean.base_prod as select * from (values
        (date '2026-08-05', 'REB 05', 'REB 05', '41000', 'POUCH X', ['Simple Laminated'], 1000.0, 50.0),
        (date '2026-08-05', 'R18',    'R18',    '41000', 'POUCH X', ['Simple Laminated'], 0.0,    30.0)
      ) t(dia, maquina, maquina_real, num_ordem, descricao, grupos, peso_bruto, refugo)""")
    con.execute("""create table clean.apara_confirmada_mes as select * from (values
        (date '2026-08-01', 150.0)) t(mes, scrap_total)""")


def test_codigos_ultimo_dia_e_series(tmp_path):
    con = _con_com_dados(tmp_path)
    _com_apontamentos_bi(con)
    pacote = publicacao.montar_pacote(con, 1, {"pasta_entrada": tmp_path, "indicadores": []})
    json.dumps(pacote)

    assert pacote["codigos"] == [{"cod": "01", "descricao": "01 - Setup", "classe": "SETUP"},
                                 {"cod": "20", "descricao": "20 - Produzindo", "classe": "PRODUZINDO"},
                                 {"cod": "99", "descricao": "99 - Fim Turno", "classe": "SEM CLASSIFICACAO"}]
    # só o último dia do BI, hora da fábrica sem fuso e sem microssegundo
    assert {e["hora_inicio"][:10] for e in pacote["ultimo_dia"]} == {"2026-09-02"}
    assert {"maquina": "R18", "cod_apont": "20", "hora_inicio": "2026-09-02T06:00:00",
            "hora_fim": "2026-09-02T09:59:59", "num_ordem": "10"} in pacote["ultimo_dia"]

    # série mensal de apara: refugo de todas as máquinas, peso bruto só das REBs
    assert pacote["apara_mes"] == [{"mes": "2026-08-01", "refugo": 80.0, "peso_bruto_rebs": 1000.0,
                                    "scrap_total": 150.0}]

    assert set(publicacao.assinaturas(con, "horas_maquina_dia")) == {date(2026, 8, 1), date(2026, 9, 1)}
    assert publicacao.assinaturas(con, "perda_dia") == {}          # tabela que não existe: série fica de fora
    assert publicacao.linhas_do_mes(con, "horas_maquina_dia", date(2026, 9, 1)) == [  # dia × máquina × código × classe
        {"dia": "2026-09-02", "maquina": "L04", "cod_apont": "20", "cod_desc": "20 - Produzindo",
         "classe": "PRODUZINDO", "horas": 2.0, "metros": 900.0},
        {"dia": "2026-09-02", "maquina": "R18", "cod_apont": "20", "cod_desc": "20 - Produzindo",
         "classe": "PRODUZINDO", "horas": 4.0, "metros": 4000.0},
        {"dia": "2026-09-02", "maquina": "R18", "cod_apont": "77", "cod_desc": "77 - Sem classe",
         "classe": "", "horas": 0.5, "metros": 0.0}]                 # sem classe vai como '' (conta no total)
    assert publicacao.linhas_do_mes(con, "apara_dia", date(2026, 8, 1))[0]["grupos"] == ["Simple Laminated"]


class _SupabaseFalso:
    """Faz o papel de requests.Session: guarda o que foi enviado pro hub_publicar
    e responde como o 002_cartoes.sql (ou como o 001, com versao=1)."""
    def __init__(self, versao=2):
        self.enviados, self.versao = [], versao

    def post(self, url, **kw):
        dados = json.loads(kw["data"])["dados"] if url.endswith("/rpc/hub_publicar") else None
        if dados is not None:
            self.enviados.append(dados)
        if dados and "conjunto" in dados and self.versao == 2:
            corpo = {"conjunto": dados["conjunto"], "linhas": len(dados["linhas"])}
        elif dados is not None:
            corpo = {"validacao": 0, "horas": 0}                   # a função do 001 ignora "conjunto"
        else:
            corpo = {"access_token": "t"}
        return type("R", (), {"status_code": 200, "text": "", "json": lambda s: corpo})()


def test_publicar_manda_so_o_mes_que_mudou(tmp_path, monkeypatch):
    con = _con_com_dados(tmp_path)
    _com_apontamentos_bi(con)
    supa = _SupabaseFalso()
    monkeypatch.setattr(publicacao, "senha_do_cofre", lambda email: "x")
    monkeypatch.setattr(publicacao, "config_supabase", lambda: {"url": "https://x", "anon_key": "k"})
    monkeypatch.setattr(publicacao.requests, "Session", lambda: supa)
    cfg = {"pasta_entrada": tmp_path, "indicadores": [], "publicacao": {"ativa": True, "email": "e@x.invalid"}}
    meses = lambda c: [(d["de"], d["ate"]) for d in supa.enviados if d.get("conjunto") == c]

    resumo = publicacao.publicar(con, 1, cfg)
    assert "horas_maquina_dia 2 mês(es)" in resumo and "apara_dia 1 mês(es)" in resumo
    assert "validacao" in supa.enviados[0] and "ultimo_dia" in supa.enviados[0] and "apara_mes" in supa.enviados[0]
    assert meses("horas_maquina_dia") == [("2026-08-01", "2026-08-31"), ("2026-09-01", "2026-09-30")]

    supa.enviados.clear()
    publicacao.publicar(con, 1, cfg)                                # nada mudou: só o pacote
    assert len(supa.enviados) == 1

    con.execute("update clean.machine_card set horas = 3 where maquina = 'L04'")
    supa.enviados.clear()
    publicacao.publicar(con, 1, cfg)
    assert meses("horas_maquina_dia") == [("2026-09-01", "2026-09-30")] and meses("apara_dia") == []

    supa.enviados.clear()
    publicacao.publicar(con, 1, cfg, republicar=True)               # "uv run hub publicar"
    assert len(meses("horas_maquina_dia")) == 2 and len(meses("apara_dia")) == 1


def test_supabase_sem_o_002_nao_marca_mes_como_publicado(tmp_path, monkeypatch):
    con = _con_com_dados(tmp_path)
    _com_apontamentos_bi(con)
    antigo = _SupabaseFalso(versao=1)
    monkeypatch.setattr(publicacao, "senha_do_cofre", lambda email: "x")
    monkeypatch.setattr(publicacao, "config_supabase", lambda: {"url": "https://x", "anon_key": "k"})
    monkeypatch.setattr(publicacao.requests, "Session", lambda: antigo)
    cfg = {"pasta_entrada": tmp_path, "indicadores": [], "publicacao": {"ativa": True, "email": "e@x.invalid"}}

    with pytest.raises(publicacao.PublicacaoFalhou, match="002_cartoes.sql"):
        publicacao.publicar(con, 1, cfg)
    assert "validacao" in antigo.enviados[0]                        # a página de qualidade atualiza igual
    assert con.execute("select count(*) from publicacao_mes").fetchone()[0] == 0

    novo = _SupabaseFalso(versao=2)                                 # rodou o 002: vai tudo
    monkeypatch.setattr(publicacao.requests, "Session", lambda: novo)
    publicacao.publicar(con, 1, cfg)
    assert len([d for d in novo.enviados if d.get("conjunto") == "horas_maquina_dia"]) == 2


def test_publicacao_desligada_ou_sem_usuario_nao_quebra(tmp_path, monkeypatch):
    con = _con_com_dados(tmp_path)
    assert publicacao.publicar(con, 1, {"publicacao": {"ativa": False}}).startswith("desligada")
    monkeypatch.setattr(publicacao, "senha_do_cofre", lambda email: None)
    assert publicacao.publicar(con, 1, {"publicacao": {"ativa": True, "email": "x@y.invalid"}}).startswith("sem usuário")
