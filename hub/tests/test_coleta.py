"""Coleta: nomes, blocos de aba de relatório e contrato quebrado mantendo o último dado bom."""
import xlsxwriter
import pytest

from hub import coleta, db
from hub.coleta import ContratoQuebrado, ler_bloco, nomes_unicos, normalizar
from hub.origens import Origens


def test_normalizar():
    assert normalizar("CodApont") == "cod_apont"
    assert normalizar("CLASSIFICAÇÃO DISP.") == "classificacao_disp"
    assert normalizar("Mês") == "mes"
    assert normalizar("usr_PesoBrutoBobina") == "usr_peso_bruto_bobina"
    assert normalizar(None) == ""


def test_nomes_unicos_desempata_colisao():
    # 'CodApont' e 'Cod_Apont' existem lado a lado na Base Apontamento
    assert nomes_unicos([normalizar("CodApont"), normalizar("Cod_Apont")]) == ["cod_apont", "cod_apont_2"]


def _planilha_relatorio(caminho):
    wb = xlsxwriter.Workbook(caminho)
    tmr = wb.add_worksheet("TMR - Teste")
    tmr.write("A1", "DISPONIBILIDADE")
    tmr.write("A3", "FLEXO")
    tmr.write_row("A5", ["Mês", "Setup", "Produzindo", "Disponibilidade"])
    tmr.write_row("A6", ["Janeiro", 0.10, 0.40, 1])
    tmr.write_row("A7", ["Fevereiro", 0.12, 0.35, 1])
    tmr.write("A10", "Semana 1")  # depois da linha vazia: fora do bloco
    vol = wb.add_worksheet("Volume (ton)")
    vol.write("A3", "Volume Flexo")
    vol.write_row("A4", ["Mês", "kg"])
    vol.write_row("A5", ["Janeiro", 100])
    vol.write("D3", "Volume Corte (JGR + OF)")
    vol.write_row("D4", ["Mês", "kg"])
    vol.write_row("D5", ["AVG 25", 401670])
    vol.write_row("D6", ["Janeiro", 353350.85])
    wb.close()


def test_ler_bloco_por_ancora(tmp_path):
    arq = tmp_path / "graficos.xlsx"
    _planilha_relatorio(str(arq))
    df = ler_bloco(arq, "TMR - Teste", "Mês")
    assert df.columns == ["mes", "setup", "produzindo", "disponibilidade"]
    assert df["mes"].to_list() == ["Janeiro", "Fevereiro"]


def test_ler_bloco_com_titulo_pega_o_bloco_certo(tmp_path):
    arq = tmp_path / "graficos.xlsx"
    _planilha_relatorio(str(arq))
    df = ler_bloco(arq, "Volume (ton)", "Mês", titulo="Volume Corte (JGR + OF)")
    assert df["mes"].to_list() == ["AVG 25", "Janeiro"]
    assert float(df["kg"][1]) == pytest.approx(353350.85)


def test_ancora_ausente_quebra_contrato(tmp_path):
    arq = tmp_path / "graficos.xlsx"
    _planilha_relatorio(str(arq))
    with pytest.raises(ContratoQuebrado):
        ler_bloco(arq, "TMR - Teste", "Month")


def _base(caminho, colunas, linhas):
    wb = xlsxwriter.Workbook(caminho)
    ws = wb.add_worksheet("Base")
    ws.write_row(0, 0, colunas)
    for i, linha in enumerate(linhas, start=1):
        ws.write_row(i, 0, linha)
    wb.close()


def test_inventario_avisa_arquivo_nao_catalogado(tmp_path):
    con = db.conectar(":memory:")
    run = con.execute("insert into processing_runs (gatilho) values ('teste') returning id").fetchone()[0]
    _base(str(tmp_path / "Base.xlsx"), ["CodRecurso"], [["R18"]])
    _base(str(tmp_path / "Planilha Nova.xlsx"), ["X"], [[1]])
    (tmp_path / "Indicadores.pbix").write_bytes(b"pbix")
    (tmp_path / "~$Base.xlsx").write_bytes(b"lock")        # arquivo de trava do Excel: ignora
    (tmp_path / "notas.txt").write_text("não é dado")     # extensão fora da lista: ignora
    fontes = [{"id": "teste.base", "arquivo": str(tmp_path / "Base.xlsx")}]

    coleta.inventariar_pasta(con, run, tmp_path, fontes)

    avisos = con.execute("select mensagem from errors where codigo = 'arquivo_nao_catalogado' "
                         "order by mensagem").fetchall()
    assert len(avisos) == 2
    assert "Indicadores.pbix" in avisos[0][0] and ".pbip" in avisos[0][0]
    assert "Planilha Nova.xlsx" in avisos[1][0]


def test_contrato_quebrado_mantem_ultimo_dado_bom(tmp_path, monkeypatch):
    monkeypatch.setattr(coleta, "RAW", tmp_path / "raw")
    con = db.conectar(":memory:")
    run = con.execute("insert into processing_runs (gatilho) values ('teste') returning id").fetchone()[0]
    arq = tmp_path / "Base.xlsx"
    fonte = {"id": "teste.base", "tipo": "excel_tabela", "origem": "local", "arquivo": str(arq),
             "aba": "Base", "colunas_obrigatorias": ["cod_recurso", "qtd_horas"]}

    _base(str(arq), ["CodRecurso", "QtdHoras"], [["R18", 1.5], ["R20", 2.0]])
    with Origens() as o:
        assert coleta.coletar(con, run, fonte, o) == "novo"
    with Origens() as o:  # mesmo arquivo, mesma regra: não relê
        assert coleta.coletar(con, run, fonte, o) == "sem_mudanca"

    _base(str(arq), ["CodRecurso", "Horas"], [["R18", 9.9]])  # alguém renomeou a coluna
    with Origens() as o, pytest.raises(ContratoQuebrado):
        coleta.coletar(con, run, fonte, o)

    assert con.execute("select count(*), sum(qtd_horas) from raw.teste__base").fetchone() == (2, 3.5)
    status = [s for (s,) in con.execute("select status from files order by id").fetchall()]
    assert status == ["novo", "sem_mudanca", "contrato_quebrado"]
