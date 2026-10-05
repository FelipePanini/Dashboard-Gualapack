from datetime import date

import polars as pl
import xlsxwriter

from hub import banco, coleta
from hub.origens import localizar


def test_meses_para_extrair_releem_os_recentes_e_os_que_faltam(tmp_path):
    banco.arquivo_do_mes(tmp_path, date(2025, 1, 1)).write_bytes(b"x")
    banco.arquivo_do_mes(tmp_path, date(2025, 4, 1)).write_bytes(b"x")
    meses = banco.meses_para_extrair(date(2025, 1, 1), tmp_path, 2, date(2025, 4, 10))
    # janeiro já existe e não é recente; fevereiro falta; março e abril são os 2 recentes
    assert meses == [date(2025, 2, 1), date(2025, 3, 1), date(2025, 4, 1)]


def test_consulta_do_mes_filtra_no_banco_e_nao_traz_nome_de_operador():
    m = banco.m_do_mes("servidor-teste", date(2025, 12, 1))
    assert "#datetime(2025, 12, 1, 0, 0, 0)" in m and "#datetime(2026, 1, 1, 0, 0, 0)" in m
    assert 'Sql.Database("servidor-teste", "Metrics")' in m
    for pessoal in ["NomeOperador", "Operador", "Obs", "usr_refugooperador", "CodOperador", "Supervisor"]:
        assert f'"{pessoal}"' not in m


def test_padronizar_nomes_tipos_e_ordem():
    bruto = pl.DataFrame({"IdApontamento": ["10", "9"], "CodApont": ["01", "40"], "Cod_Apont": ["1", "40"],
                          "DtProducao": ["2026-08-01 00:00:00", "2026-08-02 00:00:00"], "QtdHoras": ["1.5", ""]})
    df = banco.padronizar(bruto)
    assert df.columns == ["id_apontamento", "cod_apont", "cod_apont_2", "dt_producao", "qtd_horas"]
    assert df["id_apontamento"].to_list() == ["9", "10"]          # ordem numérica, não de texto
    assert df["cod_apont"].to_list() == ["40", "01"]              # código continua texto, com o zero
    assert df.schema["dt_producao"] == pl.Datetime("us") and df.schema["qtd_horas"] == pl.Float64
    assert df["qtd_horas"].to_list() == [None, 1.5]


def _excel_falso(linhas_por_mes):
    """Substitui o Excel: escreve a pasta de trabalho de saída com uma aba por mês."""
    def rodar(spec, saida):
        wb = xlsxwriter.Workbook(str(saida))
        for c in spec:
            ws = wb.add_worksheet(c["nome"])
            cab = ["IdApontamento", "NumOrdem", "CodApont", "DtProducao", "QtdHoras"]
            ws.write_row(0, 0, cab)
            for i, linha in enumerate(linhas_por_mes.get(c["nome"], []), start=1):
                ws.write_row(i, 0, linha)
        wb.close()
        return {c["nome"]: "ok" for c in spec}
    return rodar


def test_extrair_so_substitui_o_mes_quando_o_dado_muda(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "servidor": "s", "desde": "2026-08", "reextrair_meses": 2, "pasta": str(tmp_path)}}
    dados = {"m2026_08": [["2", "44000", "20", "2026-08-03 00:00:00", "1.0"], ["1", "44000", "01", "2026-08-03 00:00:00", "0.5"]],
             "m2026_09": [["3", "45000", "40", "2026-09-01 00:00:00", "0.2"]]}
    monkeypatch.setattr(banco, "_rodar_excel", _excel_falso(dados))
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert [m.split()[0] for m in mudaram] == ["08/2026", "09/2026"] and avisos == []
    assert pl.read_parquet(banco.arquivo_do_mes(tmp_path, date(2026, 8, 1)))["id_apontamento"].to_list() == ["1", "2"]

    mudaram, _ = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == []                                           # mesmo dado: nada é regravado

    dados["m2026_09"].append(["4", "45000", "20", "2026-09-02 00:00:00", "3.0"])
    mudaram, _ = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == ["09/2026 (2 linhas)"]


def test_mes_passado_vazio_nao_apaga_o_arquivo_anterior(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "servidor": "s", "desde": "2026-08", "reextrair_meses": 2, "pasta": str(tmp_path)}}
    monkeypatch.setattr(banco, "_rodar_excel", _excel_falso({"m2026_08": [["1", "1", "20", "2026-08-03 00:00:00", "1.0"]]}))
    banco.extrair(cfg, hoje=date(2026, 9, 15))
    monkeypatch.setattr(banco, "_rodar_excel", _excel_falso({}))
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == [] and any("08/2026" in a and "vazio" in a for a in avisos)
    assert pl.read_parquet(banco.arquivo_do_mes(tmp_path, date(2026, 8, 1))).height == 1


def test_sem_excel_vira_aviso_e_mantem_o_que_ja_tinha(tmp_path, monkeypatch):
    cfg = {"banco": {"ativo": True, "servidor": "s", "desde": "2026-09", "reextrair_meses": 1, "pasta": str(tmp_path)}}

    def quebra(spec, saida):
        raise RuntimeError("Excel não abriu")
    monkeypatch.setattr(banco, "_rodar_excel", quebra)
    mudaram, avisos = banco.extrair(cfg, hoje=date(2026, 9, 15))
    assert mudaram == [] and "não rodou" in avisos[0]


def test_coleta_empilha_os_parquets_mensais(tmp_path):
    for mes, h in [("2026-08", 1.0), ("2026-09", 2.0)]:
        pl.DataFrame({"id_apontamento": [mes], "qtd_horas": [h]}).write_parquet(tmp_path / f"apontamentos_{mes}.parquet")
    fonte = {"id": "banco.apontamentos", "tipo": "parquet", "varios": True,
             "arquivo": str(tmp_path / "apontamentos_*.parquet"), "colunas_obrigatorias": ["id_apontamento", "qtd_horas"]}
    arquivos = localizar(fonte)
    df, motor = coleta.ler_isolado(fonte, arquivos)
    assert motor == "parquet" and sorted(df["qtd_horas"].to_list()) == [1.0, 2.0]
