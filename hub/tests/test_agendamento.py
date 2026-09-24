"""--se-mudou: o agendador chama o hub a cada 30 min; ele só roda se algo mudou."""
import os
import time

from hub import __main__ as principal


def test_algo_mudou(tmp_path, monkeypatch):
    monkeypatch.setattr(principal, "MARCA_ULTIMA_EXECUCAO", tmp_path / "marca")
    monkeypatch.setattr(principal, "CONFIG", tmp_path / "config")
    monkeypatch.setattr(principal, "SQL", tmp_path / "sql")
    (tmp_path / "config").mkdir()
    (tmp_path / "sql").mkdir()
    entrada = tmp_path / "entrada"
    entrada.mkdir()
    antigo = entrada / "Graficos.xlsx"
    antigo.write_bytes(b"x")
    cfg = {"pasta_entrada": entrada, "fontes": []}

    assert principal.algo_mudou(cfg) == "primeira execução"

    principal.MARCA_ULTIMA_EXECUCAO.write_text(str(time.time() + 5))    # rodou depois do arquivo
    assert principal.algo_mudou(cfg) is None

    principal.MARCA_ULTIMA_EXECUCAO.write_text(str(time.time() - 60))   # arquivo chegou depois
    assert "Graficos.xlsx" in principal.algo_mudou(cfg)

    (entrada / "~$Graficos.xlsx").write_bytes(b"trava")                 # trava do Excel não conta
    agora = time.time()
    os.utime(antigo, (agora - 3600, agora - 3600))
    principal.MARCA_ULTIMA_EXECUCAO.write_text(str(agora + 5))
    assert principal.algo_mudou(cfg) is None

    principal.MARCA_ULTIMA_EXECUCAO.write_text(str(time.time() - 25 * 3600))
    assert principal.algo_mudou(cfg) == "mais de 24 h sem rodar"
