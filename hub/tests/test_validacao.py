"""Validação: cada status sai da regra certa, na ordem de precedência."""
from datetime import date

import pytest

from hub import db, validacao

HOJE = date.today()
MES_ATUAL = HOJE.replace(day=1)


@pytest.fixture
def con():
    c = db.conectar(":memory:")
    c.execute("insert into processing_runs (gatilho) values ('teste')")
    c.execute("""insert into indicators (codigo, versao, nome, unidade, grao, definicao, regra_sql,
                   fonte_oficial, fontes_comparadas, tolerancia_abs, tolerancia_pct)
                 values ('TMR', 1, 'TMR', 'pct', 'mes', 'def', 'x.sql', 'planilha', 'hub.calculo', 1.0, null),
                        ('SCRAP', 1, 'Scrap', 'pct', 'mes', 'def', 'y.sql', 'bi', null, null, null)""")
    return c


def _med(con, indicador, fonte, periodo, valor, dado_ate=None, recorte="R18"):
    con.execute("insert into measurements (run_id, indicador, versao, source_id, periodo, recorte, valor, dado_ate) "
                "values (1, ?, 1, ?, ?, ?, ?, ?)", [indicador, fonte, periodo, recorte, valor, dado_ate])


def _status(con):
    return {(r[0], r[1]): (r[2], r[3]) for r in con.execute(
        "select indicador, periodo, status, motivo from validation_results").fetchall()}


def test_status(con):
    _med(con, "TMR", "planilha", date(2025, 1, 1), 40.0)
    _med(con, "TMR", "hub.calculo", date(2025, 1, 1), 40.6, date(2025, 12, 31))      # dentro de 1 p.p.
    _med(con, "TMR", "planilha", date(2025, 2, 1), 40.0)
    _med(con, "TMR", "hub.calculo", date(2025, 2, 1), 43.0, date(2025, 12, 31))      # 3 p.p. acima
    _med(con, "TMR", "planilha", date(2025, 3, 1), 120.0)                            # impossível
    _med(con, "TMR", "hub.calculo", date(2025, 3, 1), 40.0, date(2025, 12, 31))
    _med(con, "TMR", "planilha", date(2025, 4, 1), 40.0)
    _med(con, "TMR", "hub.calculo", date(2025, 4, 1), 40.0, date(2025, 4, 15))       # base parou no dia 15
    _med(con, "TMR", "planilha", date(2025, 5, 1), 40.0)                             # hub sem o mês
    _med(con, "TMR", "planilha", MES_ATUAL, 30.0)
    _med(con, "TMR", "hub.calculo", MES_ATUAL, 35.0, HOJE)                           # mês em andamento
    _med(con, "SCRAP", "bi", date(2025, 1, 1), 16.0, date(2025, 12, 31), recorte="TOTAL")

    contagem = validacao.validar(con, 1)
    s = _status(con)
    assert s[("TMR", date(2025, 1, 1))][0] == "validado"
    assert s[("TMR", date(2025, 2, 1))][0] == "divergente"
    assert s[("TMR", date(2025, 3, 1))][0] == "erro"
    assert s[("TMR", date(2025, 4, 1))] == ("desatualizado", "dado vai só até 15/04/2025")
    assert s[("TMR", date(2025, 5, 1))] == ("erro", "fonte comparada sem este período")
    assert s[("TMR", MES_ATUAL)][0] == "aguardando"
    assert s[("SCRAP", date(2025, 1, 1))] == ("validado", "fonte única: conferidos faixa e frescor")
    assert sum(contagem.values()) == 7


def test_comparacao_opcional_nao_vira_erro(con):
    # fardos: o Acumulado tem o ano todo, o arquivo mensal só o mês dele
    con.execute("""insert into indicators (codigo, versao, nome, unidade, grao, definicao, regra_sql,
                     fonte_oficial, fontes_comparadas, comparacao_opcional, tolerancia_abs)
                   values ('APARA', 1, 'Apara', 'pct', 'mes', 'def', 'z.sql', 'acumulado', 'mensal', true, 0.1)""")
    _med(con, "APARA", "acumulado", date(2025, 7, 1), 6.5, recorte="TOTAL")
    _med(con, "APARA", "acumulado", date(2025, 8, 1), 6.6, recorte="TOTAL")
    _med(con, "APARA", "mensal", date(2025, 8, 1), 6.9, recorte="TOTAL")
    validacao.validar(con, 1)
    s = _status(con)
    assert s[("APARA", date(2025, 7, 1))] == ("validado", "sem comparação neste período: conferidos faixa e frescor")
    assert s[("APARA", date(2025, 8, 1))][0] == "divergente"
