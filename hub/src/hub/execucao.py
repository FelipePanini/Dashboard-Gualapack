"""Registro de cada execução (processing_runs) e de cada problema (errors)."""
from __future__ import annotations

import json
import shutil
import subprocess
import traceback

import duckdb

from hub.caminhos import RAIZ


def _versao_codigo() -> str | None:
    git = shutil.which("git")
    if not git:
        return None
    try:
        saida = subprocess.run([git, "rev-parse", "--short", "HEAD"], cwd=RAIZ,
                               capture_output=True, text=True, timeout=10)
        return saida.stdout.strip() or None
    except Exception:
        return None


def iniciar(con: duckdb.DuckDBPyConnection, gatilho: str) -> int:
    return con.execute(
        "insert into processing_runs (gatilho, versao_codigo) values (?, ?) returning id",
        [gatilho, _versao_codigo()],
    ).fetchone()[0]


def registrar_erro(con, run_id: int, source_id: str | None, mensagem: str, *, codigo: str,
                   gravidade: str = "erro", file_id: int | None = None, contexto: dict | None = None) -> None:
    con.execute(
        "insert into errors (run_id, source_id, file_id, gravidade, codigo, mensagem, contexto) "
        "values (?, ?, ?, ?, ?, ?, ?)",
        [run_id, source_id, file_id, gravidade, codigo, mensagem, json.dumps(contexto or {}, default=str)],
    )


def registrar_excecao(con, run_id: int, source_id: str | None, exc: Exception, codigo: str | None = None) -> None:
    registrar_erro(con, run_id, source_id, str(exc), codigo=codigo or type(exc).__name__,
                   contexto={"rastro": traceback.format_exception(exc, limit=4)})


def finalizar(con: duckdb.DuckDBPyConnection, run_id: int) -> str:
    n_erros = con.execute("select count(*) from errors where run_id = ? and gravidade = 'erro'",
                          [run_id]).fetchone()[0]
    status = "ok" if n_erros == 0 else "parcial"
    con.execute("update processing_runs set finished_at = current_timestamp, status = ? where id = ?",
                [status, run_id])
    return status
