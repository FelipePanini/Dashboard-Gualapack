from datetime import date, datetime
from decimal import Decimal

import polars as pl
import pytest

from hub import banco, coleta, sqlserver
from hub.origens import localizar


# -- trava de somente leitura -------------------------------------------------------
@pytest.mark.parametrize("sql", [
    "SELECT a FROM dbo.t",
    "  select a from dbo.t where x = 'DELETE' ;",                        # literal não conta
    "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
    "SELECT [Data Desejada (Cliente)], [Update] FROM dbo.v",              # nome entre colchetes não conta
    "SELECT a FROM t -- DROP TABLE t\n WHERE b = 1",                      # comentário não conta
    "SELECT Min_Set_Prog, Mini_Set_Real, usr_tipodaperda FROM dbo.v",     # palavra dentro de nome não conta
])
def test_so_leitura_aceita_consulta(sql):
    assert sqlserver.so_leitura(sql) == sql


@pytest.mark.parametrize("sql", [
    "DELETE FROM dbo.t",
    "UPDATE dbo.t SET a = 1",
    "INSERT INTO dbo.t VALUES (1)",
    "SELECT a INTO dbo.nova FROM dbo.t",                                  # SELECT ... INTO cria tabela
    "SELECT a FROM dbo.t; DROP TABLE dbo.t",                              # dois comandos
    "EXEC sp_who",
    "USE Metrics; SELECT 1",
    "MERGE dbo.t USING dbo.s ON 1 = 1 WHEN MATCHED THEN DELETE;",
    "TRUNCATE TABLE dbo.t",
    "SELECT * FROM OPENROWSET('x', 'y', 'z')",
    "CREATE VIEW v AS SELECT 1",
    "WITH x AS (SELECT 1 AS a) DELETE FROM dbo.t",
])
def test_so_leitura_recusa_o_que_altera_o_banco(sql):
    with pytest.raises(sqlserver.ComandoRecusado):
        sqlserver.so_leitura(sql)


def test_consultas_do_hub_passam_na_trava():
    from hub import extracoes
    sqlserver.so_leitura(f"SELECT {', '.join('[' + c + ']' for c in banco.COLUNAS)} FROM dbo.{banco.VIEW} "
                         "WHERE DtProducao >= ? AND DtProducao < ?")
    for ex in extracoes.EXTRACOES:
        sqlserver.so_leitura(ex.sql)


def test_consultar_recusa_antes_de_chegar_ao_banco():
    class ConexaoQueNaoPodeSerUsada:
        def cursor(self):
            raise AssertionError("a trava devia ter recusado antes de abrir cursor")
    with pytest.raises(sqlserver.ComandoRecusado):
        sqlserver.consultar(ConexaoQueNaoPodeSerUsada(), "DELETE FROM dbo.t")


def test_consultar_tenta_de_novo_um_erro_passageiro(monkeypatch):
    monkeypatch.setattr(sqlserver.time, "sleep", lambda s: None)
    tentativas = []

    class Cursor:
        description = [("a",)]
        def execute(self, sql, *p):
            tentativas.append(sql)
            if len(tentativas) == 1:
                raise RuntimeError("DDBC Error: Unknown DDBC error")
        def fetchall(self):
            return [(1,)]
        def close(self):
            pass

    class Con:
        def cursor(self):
            return Cursor()
    assert sqlserver.consultar(Con(), "SELECT a FROM t") == (["a"], [(1,)]) and len(tentativas) == 2


# -- apontamentos -----------------------------------------------------------------------
def test_meses_para_extrair_releem_os_recentes_e_os_que_faltam(tmp_path):
    banco.arquivo_do_mes(tmp_path, date(2025, 1, 1)).write_bytes(b"x")
    banco.arquivo_do_mes(tmp_path, date(2025, 4, 1)).write_bytes(b"x")
    meses = banco.meses_para_extrair(date(2025, 1, 1), tmp_path, 2, date(2025, 4, 10))
    # janeiro já existe e não é recente; fevereiro falta; março e abril são os 2 recentes
    assert meses == [date(2025, 2, 1), date(2025, 3, 1), date(2025, 4, 1)]


def test_colunas_dos_apontamentos_nao_trazem_dado_pessoal():
    for pessoal in ["NomeOperador", "Operador", "Obs", "usr_refugooperador", "CodOperador", "Supervisor"]:
        assert pessoal not in banco.COLUNAS


def test_padronizar_nomes_tipos_e_ordem():
    bruto = pl.DataFrame({"IdApontamento": ["10", "9"], "CodApont": ["01", "40"], "Cod_Apont": ["1", "40"],
                          "DtProducao": ["2026-08-01 00:00:00", "2026-08-02 00:00:00"], "QtdHoras": ["1.5", ""]})
    df = banco.padronizar(bruto)
    assert df.columns == ["id_apontamento", "cod_apont", "cod_apont_2", "dt_producao", "qtd_horas"]
    assert df["id_apontamento"].to_list() == ["9", "10"]          # ordem numérica, não de texto
    assert df["cod_apont"].to_list() == ["40", "01"]              # código continua texto, com o zero
    assert df.schema["dt_producao"] == pl.Datetime("us") and df.schema["qtd_horas"] == pl.Float64
    assert df["qtd_horas"].to_list() == [None, 1.5]


def test_quadro_sql_padroniza_o_que_o_driver_devolve():
    nomes = ["IdApontamento", "CodApont", "Turno", "DtProducao", "QtdHoras", "usr_Bobina", "QtdProduzida"]
    linhas = [(8265257349126.0, "40", 2, datetime(2026, 8, 1), 0.5, "1300           ", 17417),
              (8265257349125.0, "01", 1, datetime(2026, 8, 1), Decimal("1.250"), None, 0)]
    df = banco.quadro_sql(nomes, linhas)
    assert df["id_apontamento"].to_list() == ["8265257349125", "8265257349126"]   # inteiro sem ".0", ordem numérica
    assert df["cod_apont"].to_list() == ["01", "40"] and df["turno"].to_list() == ["1", "2"]
    assert df["usr_bobina"].to_list() == [None, "1300           "]              # espaços do campo fixo mantidos
    assert df["qtd_horas"].to_list() == [1.25, 0.5] and df["qtd_produzida"].to_list() == [0.0, 17417.0]
    assert df.schema["dt_producao"] == pl.Datetime("us")


def _mes(*ids):
    return banco.quadro_sql(["IdApontamento", "DtProducao"], [(float(i), datetime(2026, 9, 2)) for i in ids])


def test_extrair_so_substitui_o_mes_quando_o_dado_muda(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "desde": "2026-08", "reextrair_meses": 2, "pasta": str(tmp_path)}}
    dados = {date(2026, 8, 1): _mes(2, 1), date(2026, 9, 1): _mes(3)}
    monkeypatch.setattr(banco, "_ler_meses", lambda meses: {m: dados[m] for m in meses})
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert [m.split()[0] for m in mudaram] == ["08/2026", "09/2026"] and avisos == []
    assert pl.read_parquet(banco.arquivo_do_mes(tmp_path, date(2026, 8, 1)))["id_apontamento"].to_list() == ["1", "2"]

    mudaram, _ = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == []                                           # mesmo dado: nada é regravado

    dados[date(2026, 9, 1)] = _mes(3, 4)
    mudaram, _ = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == ["09/2026 (2 linhas)"]


def test_mes_passado_vazio_nao_apaga_o_arquivo_anterior(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "desde": "2026-08", "reextrair_meses": 2, "pasta": str(tmp_path)}}
    monkeypatch.setattr(banco, "_ler_meses", lambda meses: {m: _mes(1) for m in meses})
    banco.extrair(cfg, hoje=date(2026, 9, 15))
    monkeypatch.setattr(banco, "_ler_meses", lambda meses: {m: _mes() for m in meses})
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert any("08/2026" in a and "vazio" in a for a in avisos)
    assert pl.read_parquet(banco.arquivo_do_mes(tmp_path, date(2026, 8, 1))).height == 1


def test_sem_conexao_vira_aviso_e_mantem_o_que_ja_tinha(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "desde": "2026-09", "reextrair_meses": 1, "pasta": str(tmp_path)}}

    def sem_conexao(meses):
        raise RuntimeError("Login failed for user 'x' (18456)")
    monkeypatch.setattr(banco, "_ler_meses", sem_conexao)
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == [] and "não rodou" in avisos[0] and "'x'" not in avisos[0]   # o aviso não repete o usuário


def test_mes_com_erro_na_leitura_vira_aviso_e_nao_apaga(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "desde": "2026-09", "reextrair_meses": 1, "pasta": str(tmp_path)}}
    monkeypatch.setattr(banco, "_ler_meses", lambda meses: {m: "tempo esgotado" for m in meses})
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == [] and avisos == ["09/2026: o banco não respondeu (tempo esgotado)"]


def test_coleta_empilha_os_parquets_mensais(tmp_path):
    for mes, h in [("2026-08", 1.0), ("2026-09", 2.0)]:
        pl.DataFrame({"id_apontamento": [mes], "qtd_horas": [h]}).write_parquet(tmp_path / f"apontamentos_{mes}.parquet")
    fonte = {"id": "banco.apontamentos", "tipo": "parquet", "varios": True,
             "arquivo": str(tmp_path / "apontamentos_*.parquet"), "colunas_obrigatorias": ["id_apontamento", "qtd_horas"]}
    arquivos = localizar(fonte)
    df, motor = coleta.ler_isolado(fonte, arquivos)
    assert motor == "parquet" and sorted(df["qtd_horas"].to_list()) == [1.0, 2.0]
