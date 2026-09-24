"""Banco local (DuckDB): um arquivo só, sem servidor."""
from __future__ import annotations

from pathlib import Path

import duckdb

from hub.caminhos import BANCO, SQL


def conectar(caminho: Path | str = BANCO) -> duckdb.DuckDBPyConnection:
    if str(caminho) != ":memory:":
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(caminho))
    con.execute(ler_sql("001_metadados.sql"))
    return con


def ler_sql(relativo: str) -> str:
    return (SQL / relativo).read_text(encoding="utf-8")


def tabela_existe(con: duckdb.DuckDBPyConnection, nome_completo: str) -> bool:
    esquema, tabela = nome_completo.split(".", 1)
    return con.execute(
        "select count(*) from information_schema.tables where table_schema = ? and table_name = ?",
        [esquema, tabela],
    ).fetchone()[0] > 0
