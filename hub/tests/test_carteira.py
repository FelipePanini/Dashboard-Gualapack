from datetime import datetime

import duckdb
import pytest

from hub.caminhos import SQL


@pytest.fixture
def con():
    con = duckdb.connect()
    con.execute("create schema raw; create schema clean")
    con.execute((SQL / "clean" / "100_banco.sql").read_text(encoding="utf-8"))
    return con


def _pedido(num, item, unidade, qtd, faturada, total_kg, status="Liberado", desejada=datetime(2026, 8, 20)):
    return (num, 1.0, "CLIENTE", 1.0, status, datetime(2026, 7, 1), desejada, datetime(1899, 12, 30), datetime(1899, 12, 30),
            item, "PRODUTO", unidade, qtd, faturada, total_kg, "ALIMENTICIOS", "S")


def test_carteira_conta_cada_item_uma_vez_e_pesa_pela_gramatura(con):
    linhas = [
        _pedido("1", "PA1", "KG", 1000.0, 400.0, 1000.0),
        _pedido("1", "PA1", "KG", 1000.0, 400.0, 1000.0),      # a view repete o item a cada entrega
        _pedido("2", "PA2", "M2", 10000.0, 0.0, 10000.0),      # PesoEMKG 1,0 no cadastro: 10 t que não existem
        _pedido("3", "PA3", "M2", 5000.0, 0.0, 0.0),           # sem estrutura: gramatura da última nota
        _pedido("4", "PA4", "M2", 2000.0, 0.0, 2000.0),        # sem estrutura nem nota: sem peso
        _pedido("5", "PA5", "MIL", 30.0, 0.0, 30.0),           # milheiro: sem peso
        _pedido("6", "PA1", "KG", 500.0, 500.0, 500.0, status="Encerrado"),
        _pedido("7", "PA2", "M2", 100.0, 0.0, 100.0, status="Cancelado"),
    ]
    con.executemany("insert into raw.banco__carteira values (" + ", ".join(["?"] * 17) + ")", linhas)
    con.execute("insert into raw.banco__gramatura_produto values ('PA2', 115.0), ('PA4', 0.0)")
    con.execute("""insert into raw.banco__faturamento (data_emissao, sku, gramatura_total) values
                   (timestamp '2026-06-01', 'PA3', 80.0), (timestamp '2026-07-01', 'PA3', 90.0)""")
    con.execute((SQL / "clean" / "190_carteira.sql").read_text(encoding="utf-8"))

    aberta = {r[0]: r[1:] for r in con.execute(
        "select num_pedido, saldo, kg_saldo from clean.carteira_aberta order by 1").fetchall()}
    assert aberta == {"1": (600.0, 600.0),                     # um item só, kg = a própria quantidade
                      "2": (10000.0, pytest.approx(1150.0)),   # 10.000 m² × 115 g/m²
                      "3": (5000.0, pytest.approx(450.0)),     # gramatura da nota mais recente (90)
                      "4": (2000.0, None),                     # sem gramatura: vazio, nunca chutado
                      "5": (30.0, None)}
    mes = con.execute("select itens, pedidos, kg from clean.carteira_mes").fetchall()
    # agosto: os 6 itens distintos menos o cancelado; kg dos que têm peso (1000 + 1150 + 450 + 500)
    assert mes == [(6, 6, pytest.approx(1000.0 + 1150.0 + 450.0 + 500.0))]
