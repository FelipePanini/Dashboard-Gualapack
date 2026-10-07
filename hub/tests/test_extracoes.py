from datetime import date, datetime
from decimal import Decimal

import polars as pl

from hub import extracoes
from hub.extracoes import Extracao


class ConexaoFalsa:
    """Responde às consultas com linhas prontas; guarda o que foi pedido."""

    def __init__(self, respostas):
        self.respostas = respostas          # função (sql, params) -> (nomes, linhas)
        self.pedidos = []

    def cursor(self):
        con = self

        class Cursor:
            def execute(self, sql, *p):
                con.pedidos.append((sql, p[0] if p else ()))
                self.description = [(n,) for n in con.respostas(sql, p[0] if p else ())[0]]
                self._linhas = con.respostas(sql, p[0] if p else ())[1]

            def fetchall(self):
                return self._linhas

            def close(self):
                pass
        return Cursor()

    def close(self):
        pass


def test_quadro_tipos_e_nomes():
    df = extracoes.quadro(["NumOrdem", "DtIniPlan", "QtdKg", "Situacao", "Data Desejada (Cliente)"],
                          [("45069", datetime(2026, 10, 5, 7, 0), Decimal("12.50"), 1, date(2026, 10, 20)),
                           (45070.0, None, None, None, None)])
    assert df.columns == ["num_ordem", "dt_ini_plan", "qtd_kg", "situacao", "data_desejada_cliente"]
    assert df["num_ordem"].to_list() == ["45069", "45070"]          # número inteiro vira texto sem ".0"
    assert df.schema["dt_ini_plan"] == pl.Datetime("us") and df.schema["data_desejada_cliente"] == pl.Datetime("us")
    assert df["qtd_kg"].to_list() == [12.5, None] and df.schema["situacao"] == pl.Float64


def test_primeiro_por_mantem_a_primeira_linha_de_cada_chave():
    df = extracoes.quadro(["CodEstrutura", "PFmtPagL"], [("A", 100), ("B", 200), ("A", 999)], ("cod_estrutura",))
    assert df.rows() == [("A", 100.0), ("B", 200.0)]                  # como o Table.Distinct do Excel


def test_foto_grava_so_quando_muda_e_guarda_historico_do_dia(tmp_path):
    cfg = {"banco": {"ativo": True, "pasta": str(tmp_path)}}
    ex = [Extracao("prog", "teste", "SELECT a FROM t", historico_diario=True)]
    linhas = [[("x",)]]
    con = ConexaoFalsa(lambda sql, p: (["a"], linhas[0]))
    mudaram, avisos = extracoes.extrair(cfg, hoje=date(2026, 10, 5), extracoes=ex, conectar=lambda: con)
    assert mudaram == ["prog (1 linhas)"] and avisos == []
    assert (tmp_path / "historico" / "prog_2026-10-05.parquet").exists()
    mudaram, _ = extracoes.extrair(cfg, hoje=date(2026, 10, 5), extracoes=ex, conectar=lambda: con)
    assert mudaram == []                                               # mesma foto: nada regravado
    linhas[0] = [("x",), ("y",)]
    mudaram, _ = extracoes.extrair(cfg, hoje=date(2026, 10, 5), extracoes=ex, conectar=lambda: con)
    assert mudaram == ["prog (2 linhas)"]
    assert pl.read_parquet(tmp_path / "historico" / "prog_2026-10-05.parquet").height == 1   # a primeira do dia fica


def test_mensal_pede_o_intervalo_do_mes_e_rele_os_recentes(tmp_path):
    cfg = {"banco": {"ativo": True, "pasta": str(tmp_path)}}
    ex = [Extracao("laudos", "teste", "SELECT a FROM t WHERE d >= ? AND d < ?", mensal=True, desde="2026-08", reextrair=1)]
    con = ConexaoFalsa(lambda sql, p: (["a"], [(p[0].month,)]))
    mudaram, _ = extracoes.extrair(cfg, hoje=date(2026, 10, 5), extracoes=ex, conectar=lambda: con)
    assert [p for _, p in con.pedidos] == [(date(2026, 8, 1), date(2026, 9, 1)), (date(2026, 9, 1), date(2026, 10, 1)),
                                           (date(2026, 10, 1), date(2026, 11, 1))]
    assert len(mudaram) == 3 and (tmp_path / "laudos_2026-08.parquet").exists()
    con.pedidos.clear()
    extracoes.extrair(cfg, hoje=date(2026, 10, 5), extracoes=ex, conectar=lambda: con)
    assert [p for _, p in con.pedidos] == [(date(2026, 10, 1), date(2026, 11, 1))]   # só o mês recente


def test_intervalo_minimo_entre_leituras(tmp_path):
    cfg = {"banco": {"ativo": True, "pasta": str(tmp_path)}}
    ex = [Extracao("lenta", "teste", "SELECT a FROM t", intervalo_min=30)]
    con = ConexaoFalsa(lambda sql, p: (["a"], [(1,)]))
    extracoes.extrair(cfg, extracoes=ex, conectar=lambda: con)
    extracoes.extrair(cfg, extracoes=ex, conectar=lambda: con)
    assert len(con.pedidos) == 1                                      # a segunda ficou pra daqui a 30 min


def test_erro_numa_extracao_nao_derruba_as_outras(tmp_path):
    cfg = {"banco": {"ativo": True, "pasta": str(tmp_path)}}
    ex = [Extracao("quebrada", "teste", "SELECT a FROM quebrada"), Extracao("boa", "teste", "SELECT a FROM boa")]

    def responde(sql, p):
        if "quebrada" in sql:
            raise RuntimeError("Invalid object name 'dbo.quebrada'")
        return ["a"], [(1,)]
    mudaram, avisos = extracoes.extrair(cfg, extracoes=ex, conectar=lambda: ConexaoFalsa(responde))
    assert mudaram == ["boa (1 linhas)"] and len(avisos) == 1 and avisos[0].startswith("quebrada:")
    assert not (tmp_path / "quebrada.parquet").exists()


def test_sem_conexao_vira_aviso(tmp_path):
    cfg = {"banco": {"ativo": True, "pasta": str(tmp_path)}}

    def sem_conexao():
        raise RuntimeError("Login failed for user 'x'")
    mudaram, avisos = extracoes.extrair(cfg, extracoes=[Extracao("a", "t", "SELECT 1")], conectar=sem_conexao)
    assert mudaram == [] and "não rodou" in avisos[0] and "'x'" not in avisos[0]


def test_extracoes_nao_pedem_coluna_pessoal():
    pessoais = ["Operador", "NomeOperador", "CodOperador", "UsuarioAnalise", "Obs ", "Obs,", "Vendedor", "BarCode",
                "PrecoUnitario", "PrecoTotal", "Valor Total", "InsUser", "PrintUser"]
    for ex in extracoes.EXTRACOES:
        sel = ex.sql.split("FROM")[0] if ex.nome != "entregas" else ex.sql.split("FROM (")[0]
        for p in pessoais:
            assert p not in sel, f"{ex.nome} pede {p}"
