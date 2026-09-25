"""Espelho: cópia da pasta compartilhada pra pasta de entrada."""
import os
import sys
import time

import pytest

from hub import espelho


def _arquivo(caminho, conteudo: bytes, horario: float):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_bytes(conteudo)
    os.utime(caminho, (horario, horario))
    return caminho


@pytest.fixture(autouse=True)
def guarda_temporaria(tmp_path, monkeypatch):
    """Nenhum teste grava em hub/data de verdade."""
    monkeypatch.setattr(espelho, "DADOS", tmp_path / "dados")
    return tmp_path / "dados" / "espelho_substituidos"


@pytest.fixture
def pastas(tmp_path):
    originais, entrada = tmp_path / "compartilhada", tmp_path / "Dados do Painel"
    agora = time.time()
    _arquivo(originais / "02 - Indicadores" / "Indicadores.xlsx", b"novo", agora)
    _arquivo(entrada / "Indicadores" / "Indicadores.xlsx", b"velho", agora - 3600)       # original mais novo
    _arquivo(originais / "Machine Card.xlsx", b"igual", agora - 100)
    _arquivo(entrada / "Machine Card" / "Machine Card.xlsx", b"igual", agora - 100)    # mesma versão
    _arquivo(originais / "Refugo.xlsx", b"original", agora - 3600)
    _arquivo(entrada / "Refugo.xlsx", b"editado na copia", agora)                       # cópia mais nova
    for mes, idade in (("08. FARDOS - Agosto 2026.xlsx", 9000), ("09. FARDOS - Setembro 2026.xlsx", 60)):
        _arquivo(originais / "Fardos" / mes, mes.encode(), agora - idade)
    _arquivo(entrada / "Aparas" / "08. FARDOS - Agosto 2026.xlsx", b"08. FARDOS - Agosto 2026.xlsx", agora - 9000)
    cfg = {"ano": 2026, "pasta_entrada": entrada, "pasta_originais": originais, "espelho": [
        r"02 - Indicadores\Indicadores.xlsx".replace("\\", os.sep),
        "Machine Card.xlsx",
        "Refugo.xlsx",
        os.path.join("Fardos", "*FARDOS*{ano}.xlsx"),
        "Nao existe.xlsx",
    ]}
    return cfg, originais, entrada


def test_copia_so_o_que_mudou_e_protege_a_copia_editada(pastas, guarda_temporaria):
    cfg, originais, entrada = pastas
    copiados, avisos = espelho.espelhar(cfg)

    assert copiados == ["Indicadores.xlsx", "09. FARDOS - Setembro 2026.xlsx"]
    destino = entrada / "Indicadores" / "Indicadores.xlsx"                  # fica na subpasta da cópia
    assert destino.read_bytes() == b"novo"
    assert (guarda_temporaria / "Indicadores.xlsx").read_bytes() == b"velho"  # a substituída fica guardada
    assert abs(destino.stat().st_mtime - (originais / "02 - Indicadores" / "Indicadores.xlsx").stat().st_mtime) < 1
    assert (entrada / "Refugo.xlsx").read_bytes() == b"editado na copia"     # não sobrescreve a cópia editada
    assert (entrada / "Aparas" / "09. FARDOS - Setembro 2026.xlsx").exists()  # arquivo do mês novo, junto do anterior
    assert (entrada / "Aparas" / "08. FARDOS - Agosto 2026.xlsx").stat().st_mtime < time.time() - 8000  # intacto
    assert not list(entrada.rglob("~$hub-*"))
    assert len(avisos) == 2
    assert "Refugo.xlsx" in avisos[0] and "mais nova que o original" in avisos[0]
    assert "Nao existe.xlsx" in avisos[1]

    assert espelho.espelhar(cfg)[0] == []                                  # segunda vez: nada a copiar


def test_caminho_absoluto_e_sem_catalogo(tmp_path):
    original = _arquivo(tmp_path / "outra" / "Refugo Aparas.xlsx", b"x", time.time())
    entrada = tmp_path / "entrada"
    entrada.mkdir()
    cfg = {"ano": 2026, "pasta_entrada": entrada, "pasta_originais": None, "espelho": [str(original)]}
    assert espelho.espelhar(cfg) == (["Refugo Aparas.xlsx"], [])
    assert espelho.espelhar({**cfg, "espelho": []}) == ([], [])
    _, avisos = espelho.espelhar({**cfg, "espelho": ["relativo.xlsx"]})
    assert "pastas.originais" in avisos[0]


def test_serie_de_arquivos_do_mes(tmp_path):
    originais, entrada, agora = tmp_path / "orig", tmp_path / "entrada", time.time()
    serie = os.path.join("TB", "*FARDOS*{ano}.xlsx")
    cfg = {"ano": 2026, "pasta_entrada": entrada, "pasta_originais": originais, "espelho": [serie]}
    _arquivo(originais / "TB" / "07. FARDOS - Julho 2026.xlsx", b"jul", agora - 90000)
    _arquivo(originais / "TB" / "08. FARDOS - Agosto 2026.xlsx", b"ago", agora - 50000)
    _arquivo(entrada / "Aparas" / "08. FARDOS - Agosto 2026.xlsx", b"ago", agora - 50000)
    _arquivo(originais / "TB" / "01. FARDOS - Janeiro 2025.xlsx", b"outro ano", agora)

    # virada do mês: aparece o de setembro -> vem pra pasta do de agosto; julho não vem
    _arquivo(originais / "TB" / "09. FARDOS - Setembro 2026.xlsx", b"set", agora - 60)
    assert espelho.espelhar(cfg) == (["09. FARDOS - Setembro 2026.xlsx"], [])
    assert (entrada / "Aparas" / "09. FARDOS - Setembro 2026.xlsx").read_bytes() == b"set"

    # agosto fechado depois: a edição chega; julho editado agora continua fora
    _arquivo(originais / "TB" / "08. FARDOS - Agosto 2026.xlsx", b"ago fechado", agora - 10)
    _arquivo(originais / "TB" / "07. FARDOS - Julho 2026.xlsx", b"jul revisto", agora - 5)
    assert espelho.espelhar(cfg) == (["08. FARDOS - Agosto 2026.xlsx"], [])
    assert not (entrada / "Aparas" / "07. FARDOS - Julho 2026.xlsx").exists()


def test_revisao_nova_substitui_a_antiga(tmp_path):
    originais, entrada, guarda, agora = tmp_path / "orig", tmp_path / "entrada", tmp_path / "guarda", time.time()
    cfg = {"ano": 2026, "pasta_entrada": entrada, "pasta_originais": originais,
           "espelho": [{"original": "Acumulado {ano} Rev*.xlsx", "so_o_ultimo": True}]}
    _arquivo(originais / "Acumulado 2026 Rev2.xlsx", b"rev2", agora - 5000)
    _arquivo(entrada / "Aparas" / "Acumulado 2026 Rev2.xlsx", b"rev2", agora - 5000)
    assert espelho.espelhar(cfg, guarda) == ([], [])

    _arquivo(originais / "Acumulado 2026 Rev3.xlsx", b"rev3", agora - 10)
    assert espelho.espelhar(cfg, guarda) == (["Acumulado 2026 Rev3.xlsx"], [])
    assert [p.name for p in entrada.rglob("*.xlsx")] == ["Acumulado 2026 Rev3.xlsx"]   # uma revisão por vez
    assert [p.name.split(" ", 1)[1] for p in guarda.iterdir()] == ["Acumulado 2026 Rev2.xlsx"]  # guardada, não apagada

    # revisão antiga com edição local não sai da pasta: vira aviso
    _arquivo(entrada / "Aparas" / "Acumulado 2026 Rev2.xlsx", b"rev2 editada", agora)
    copiados, avisos = espelho.espelhar(cfg, guarda)
    assert copiados == [] and "edição" in avisos[0]
    assert (entrada / "Aparas" / "Acumulado 2026 Rev2.xlsx").exists()


@pytest.mark.skipif(sys.platform != "win32", reason="trava de arquivo aberto é do Windows")
def test_copia_aberta_no_excel_fica_pra_proxima(pastas):
    cfg, _, entrada = pastas
    with open(entrada / "Indicadores" / "Indicadores.xlsx", "rb"):             # como o Excel segurando o arquivo
        copiados, avisos = espelho.espelhar(cfg)
    assert "Indicadores.xlsx" not in copiados
    assert any("tento de novo" in a for a in avisos)
    assert not list(entrada.rglob("~$hub-*"))
    assert "Indicadores.xlsx" in espelho.espelhar(cfg)[0]                  # solto o arquivo, copia
