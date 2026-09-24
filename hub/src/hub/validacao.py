"""Compara cada medição com a da fonte oficial (sql/validacao.sql)."""
from __future__ import annotations

import duckdb

from hub.db import ler_sql


def validar(con: duckdb.DuckDBPyConnection, run_id: int) -> dict[str, int]:
    con.execute(ler_sql("validacao.sql"), {"run": run_id})
    return dict(con.execute(
        "select status, count(*) from validation_results where run_id = ? group by status", [run_id]
    ).fetchall())
