"""Linha do tempo por dia de produção, plano x realizado do BI e a apara
confirmada do mês em andamento (006_tempo_aderencia.sql)."""
import json
from datetime import date, datetime, timedelta

import duckdb

from hub import publicacao
from hub.caminhos import SQL

from tests.test_publicacao import _con_com_dados, _SupabaseFalso


def _apontamentos(con, linhas):
    con.execute("create schema if not exists raw; create schema if not exists clean")
    con.execute((SQL / "clean" / "100_banco.sql").read_text(encoding="utf-8"))
    con.executemany("""insert into raw.banco__apontamentos
        (cod_recurso, cod_apont, cod_desc, dt_producao, hora_inicio, hora_fim, num_ordem, dt_inclusao,
         qtd_produzida, processo, des_num_ordem) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", linhas)


def _ev(maq, cod, dia, ini, fim, incl=None, qtd=0.0, processo="IMPRESSAO", des="SACHET"):
    return (maq, cod, f"{cod} - x", dia, ini, fim, "10", incl or ini, qtd, processo, des)


def test_eventos_por_dia_usam_a_janela_das_6h_as_6h():
    con = duckdb.connect()
    d1, d2 = datetime(2026, 10, 5), datetime(2026, 10, 6)
    _apontamentos(con, [
        _ev("R18", "20", d1, datetime(2026, 10, 5, 6, 0), datetime(2026, 10, 5, 14, 0)),
        _ev("R18", "20", d1, datetime(2026, 10, 6, 2, 0), datetime(2026, 10, 6, 5, 0)),     # turno da noite: ainda é o dia 5
        _ev("R18", "40", d1, datetime(2026, 10, 5, 9, 0), datetime(2026, 10, 5, 9, 0)),     # instantâneo: fica de fora
        _ev("L04", "1", d1, datetime(2026, 10, 6, 4, 53), datetime(1899, 12, 30)),          # aberto desde o dia 5
        _ev("R18", "20", d2, datetime(2026, 10, 6, 6, 0), datetime(2026, 10, 6, 7, 0),
            incl=datetime(2026, 10, 6, 7, 30)),
    ])
    dias = publicacao.eventos_por_dia(con)
    assert sorted(dias) == [date(2026, 10, 5), date(2026, 10, 6)]
    dia5 = [(e["maquina"], e["cod_apont"], e["hora_inicio"]) for e in dias[date(2026, 10, 5)]]
    assert ("R18", "20", "2026-10-06T02:00:00") in dia5 and not [e for e in dia5 if e[1] == "40"]
    # o evento aberto da L04 começou no dia 5 e segue no dia 6: aparece nos dois, até o dado mais novo
    l04 = [e for e in dias[date(2026, 10, 6)] if e["maquina"] == "L04"]
    assert l04 and l04[0]["hora_fim"] == "2026-10-06T07:30:00" and l04[0]["dia"] == "2026-10-06"
    assert [e for e in dias[date(2026, 10, 5)] if e["maquina"] == "L04"]


def test_plano_dia_tem_os_filtros_da_producao_metros_do_bi():
    con = duckdb.connect()
    d = datetime(2026, 9, 10)
    _apontamentos(con, [
        _ev("R18", "20", d, d, d + timedelta(hours=2), qtd=1000.0),
        _ev("R18", "20", d, d, d + timedelta(hours=1), qtd=500.0, processo="IMPRESSAO WIP"),   # WIP: fora
        _ev("R18", "20", d, d, d + timedelta(hours=1), qtd=300.0, processo="REVISÃO FILME"),  # revisão: fora
        _ev("R18", "20", d, d, d + timedelta(hours=1), qtd=200.0, des="REVISAO SACHET"),      # OP de revisão: fora
    ])
    con.execute("""create table raw.aderencia__programacao as select * from (values
        ('1', 'R18 ', 1500.0, timestamp '2026-09-10 08:00'), ('2', 'r18', 500.0, timestamp '2026-09-10 20:00'),
        ('3', 'L04', 900.0, timestamp '2026-09-11 06:00'),
        ('4', 'REVISORA 01', 700.0, timestamp '2026-09-11 06:00')) t(num_ordem, cod_recurso, qtd_planejada, dt_ini_plan)""")
    con.execute((SQL / "clean" / "210_plano.sql").read_text(encoding="utf-8"))
    assert con.execute("select dia, maquina, planejado, realizado from clean.plano_dia order by 1, 2").fetchall() == [
        (date(2026, 9, 10), "R18", 2000.0, 1000.0), (date(2026, 9, 11), "L04", 900.0, 0.0)]


def test_publicar_manda_so_o_dia_que_mudou_e_aguenta_sem_o_006(tmp_path, monkeypatch):
    con = _con_com_dados(tmp_path)
    d = datetime(2026, 10, 5)
    _apontamentos(con, [_ev("R18", "20", d, datetime(2026, 10, 5, 6), datetime(2026, 10, 5, 8)),
                        _ev("R18", "20", datetime(2026, 10, 6), datetime(2026, 10, 6, 6), datetime(2026, 10, 6, 9))])
    con.execute("create table clean.classificacao as select '20' as cod, 'PRODUZINDO' as classe")
    monkeypatch.setattr(publicacao, "senha_do_cofre", lambda email: "x")
    monkeypatch.setattr(publicacao, "config_supabase", lambda: {"url": "https://x", "anon_key": "k"})
    cfg = {"pasta_entrada": tmp_path, "indicadores": [], "publicacao": {"ativa": True, "email": "e@x.invalid"}}

    # sem o 006: o Supabase não conhece evento_dia; o resto publica e o resumo avisa
    class Sem006(_SupabaseFalso):
        def post(self, url, **kw):
            dados = json.loads(kw["data"])["dados"] if url.endswith("/rpc/hub_publicar") else None
            if dados and dados.get("conjunto") in ("evento_dia", "plano_dia"):
                return type("R", (), {"status_code": 400, "text": f'conjunto desconhecido: {dados["conjunto"]}',
                                      "json": lambda s: {}})()
            return super().post(url, **kw)
    monkeypatch.setattr(publicacao.requests, "Session", lambda: Sem006())
    resumo = publicacao.publicar(con, 1, cfg)
    assert "sem o 006_tempo_aderencia.sql" in resumo and "evento_dia" in resumo

    # com o 006: os dois dias vão; na rodada seguinte, nada mudou, nada vai
    supa = _SupabaseFalso()
    monkeypatch.setattr(publicacao.requests, "Session", lambda: supa)
    resumo = publicacao.publicar(con, 1, cfg)
    dias = [(x["de"], x["ate"]) for x in supa.enviados if x.get("conjunto") == "evento_dia"]
    assert dias == [("2026-10-05", "2026-10-05"), ("2026-10-06", "2026-10-06")] and "linha do tempo 2 dia(s)" in resumo
    supa.enviados.clear()
    publicacao.publicar(con, 1, cfg)
    assert not [x for x in supa.enviados if x.get("conjunto") == "evento_dia"]


def test_apara_confirmada_leva_as_colunas_da_conta_refugo_em_todo_mes():
    # o painel mostra a "% JGR" da planilha: scrap JGR ÷ (volume JGR + scrap JGR)
    con = duckdb.connect()
    con.execute("create schema clean")
    con.execute("""create table clean.base_prod as select * from (values
        (date '2026-03-05', 'REB 05', 100.0, 1000.0), (date '2026-10-02', 'REB 05', 50.0, 900.0))
        t(dia, maquina_real, refugo, peso_bruto)""")
    con.execute("""create table clean.apara_confirmada_mes as select * from (values
        (date '2026-03-01', 345838.0, 57408.5, 64147.2), (date '2026-10-01', 62391.9, 11618.4, 11618.4))
        t(mes, volume_jgr, scrap_jgr, scrap_total)""")
    linhas = {r["mes"]: r for r in publicacao.apara_mes(con)}
    mar, out = linhas["2026-03-01"], linhas["2026-10-01"]
    assert (mar["volume_jgr"], mar["scrap_jgr"], mar["scrap_total"]) == (345838.0, 57408.5, 64147.2)
    assert round(100 * mar["scrap_jgr"] / (mar["volume_jgr"] + mar["scrap_jgr"]), 2) == 14.24   # % JGR de mar/2026
    assert round(100 * out["scrap_jgr"] / (out["volume_jgr"] + out["scrap_jgr"]), 2) == 15.70   # % JGR de out/2026
