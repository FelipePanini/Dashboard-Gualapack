"""Programado x produzido por OP e máquina (009_gestao.sql): a última programação
contra a maior passada."""
from datetime import date, datetime, timedelta

import duckdb

from hub import publicacao
from hub.caminhos import SQL

from tests.test_tempo_aderencia import _apontamentos


def _ev(maq, op, dia, qtd, processo="IMPRESSAO", des="SACHET 10G"):
    return (maq, "20", "20 - Produzindo", dia, dia, dia + timedelta(hours=1), op, dia, qtd, processo, des)


def test_op_plano_usa_a_ultima_programacao_e_a_maior_passada():
    con = duckdb.connect()
    d1, d2 = datetime(2026, 9, 10), datetime(2026, 9, 12)
    _apontamentos(con, [
        # R18: duas corridas do mesmo processo somam (1.100 m)
        _ev("R18", "10", d1, 600.0), _ev("R18", "10", d2, 500.0),
        _ev("R18", "10", d2, 400.0, processo="IMPRESSAO WIP"),        # WIP: fora
        # L04: três passadas da mesma OP, cada uma com o comprimento todo: vale a maior
        _ev("L04", "20", d1, 900.0, processo="ALIMENTOBASE ACETATO ALIMENTO"),
        _ev("L04", "20", d2, 1000.0, processo="ALIMENTOB ACETATO 2 ALIMENTO"),
        _ev("L04", "20", d2, 950.0, processo="ALIMENTOB ACETATO 3 ALIMENTO"),
        # OP sem programação: fora (não há com o que comparar)
        _ev("R20", "30", d1, 500.0),
    ])
    con.execute("""create or replace table raw.aderencia__programacao as select * from (values
        ('10', 'R18', 1000.0, timestamp '2026-09-01 08:00'),
        ('10', 'r18 ', 1000.0, timestamp '2026-09-09 08:00'),            -- reprogramação: a mesma OP de novo
        ('20', 'L04', 980.0, timestamp '2026-09-08 06:00'),
        ('20', 'L04', 980.0, timestamp '2026-09-09 06:00'),
        ('40', 'REVISORA 01', 700.0, timestamp '2026-09-11 06:00')) t(num_ordem, cod_recurso, qtd_planejada, dt_ini_plan)""")
    con.execute((SQL / "clean" / "220_op_plano.sql").read_text(encoding="utf-8"))
    linhas = {r[1]: r for r in con.execute(
        "select dia, maquina, num_ordem, produto, planejado, produzido, passadas from clean.op_plano_dia").fetchall()}
    assert sorted(linhas) == ["L04", "R18"]
    assert linhas["R18"][4:] == (1000.0, 1100.0, 1) and linhas["R18"][0] == date(2026, 9, 12)
    assert linhas["L04"][4:] == (980.0, 1000.0, 3) and linhas["L04"][3] == "SACHET 10G"


def test_op_plano_vai_no_pacote_so_com_o_009():
    assert publicacao.SQL_DO_CONJUNTO["op_plano_dia"] == "009_gestao.sql"
    tabela, consulta = publicacao.CONJUNTOS["op_plano_dia"]
    assert tabela == "clean.op_plano_dia" and "passadas" in consulta
