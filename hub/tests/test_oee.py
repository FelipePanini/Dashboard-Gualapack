"""Qualidade (aparas) de cada máquina para o OEE dos cartões (007_oee.sql)."""
from datetime import date

import duckdb

from hub.caminhos import SQL


def _con():
    con = duckdb.connect()
    con.execute("create schema clean")
    con.execute("""create table clean.machine_card as select * from (values
        (date '2026-09-02', 'R18', '20', 'PRODUZINDO', 3.0, 9000.0, '100'),
        (date '2026-09-05', 'R18', '20', 'PRODUZINDO', 2.0, 6000.0, '100'),   -- mesma OP: conta uma vez, no dia 05
        (date '2026-09-05', 'R18', '01', 'SETUP',      1.0,    0.0, '101'),   -- setup não é produzir
        (date '2026-09-06', 'R18', '20', 'PRODUZINDO', 2.0, 5000.0, '102'),   -- OP ainda sem peso: fica de fora
        (date '2026-09-08', 'L04', '20', 'PRODUZINDO', 4.0, 8000.0, '100'),
        (date '2026-09-10', 'REB 05', '20', 'PRODUZINDO', 3.0, 7000.0, '100'))
        t(dia, maquina, cod_apont, classe, horas, metros, num_ordem)""")
    con.execute("""create table clean.base_prod as select * from (values
        (date '2026-09-02', 'R18', 'R18', '100', 'X', 'PA', 0.0, 30.0, ['Simple']),
        (date '2026-09-05', 'R18', 'R18', '100', 'X', 'PA', 0.0, 20.0, ['Simple']),
        (date '2026-09-06', 'R18', 'R18', '102', 'Y', 'PA', 0.0, 99.0, ['Simple']),
        (date '2026-09-08', 'L04', 'L04', '100', 'X', 'PA', 0.0, 25.0, ['Simple']),
        (date '2026-09-10', 'REB 05', 'REB 05', '100', 'X', 'PA', 950.0, 50.0, ['Simple']))
        t(dia, maquina, maquina_real, num_ordem, descricao, tipo_produto, peso_bruto, refugo, grupos)""")
    con.execute((SQL / "clean" / "230_qualidade_maquina.sql").read_text(encoding="utf-8"))
    return con


def test_cada_maquina_ve_o_peso_final_da_op_uma_vez_no_ultimo_dia():
    linhas = _con().execute("select dia, maquina, refugo_kg, peso_ops_kg, ops from clean.qualidade_maquina_dia order by 2").fetchall()
    assert linhas == [
        (date(2026, 9, 8), "L04", 25.0, 950.0, 1),
        (date(2026, 9, 5), "R18", 50.0, 950.0, 1),       # 30 + 20 kg da OP 100; a 102 (sem peso) fica de fora
        (date(2026, 9, 10), "REB 05", 50.0, 950.0, 1),
    ]


def test_qualidade_da_maquina_e_100_menos_a_apara_dela():
    con = _con()
    r18 = con.execute("""select 100 - 100 * sum(refugo_kg) / (sum(refugo_kg) + sum(peso_ops_kg))
                         from clean.qualidade_maquina_dia where maquina = 'R18'""").fetchone()[0]
    assert round(r18, 2) == 95.0   # 50 ÷ (50 + 950) = 5% de apara
