"""RAW -> CLEAN (sql/clean/*.sql) e checagens de qualidade (sql/checagens/*.sql).

Cada arquivo SQL roda sozinho: se um falha (ex.: fonte que nunca carregou),
o erro é registrado e os outros seguem.
"""
from __future__ import annotations

import duckdb
import polars as pl

from hub import execucao
from hub.caminhos import SQL


def preparar_parametros(con: duckdb.DuckDBPyConnection, cfg: dict) -> None:
    con.execute("create or replace table cfg.parametros as select ?::integer as ano", [cfg["ano"]])
    pares = [(recorte, str(m).strip().upper()) for recorte, maquinas in cfg["recortes"].items() for m in maquinas]
    con.register("_recortes", pl.DataFrame(pares, schema={"recorte": pl.String, "maquina": pl.String}, orient="row"))
    con.execute("create or replace table cfg.recorte_maquina as select * from _recortes")
    con.unregister("_recortes")


def executar_clean(con: duckdb.DuckDBPyConnection, run_id: int) -> None:
    for arquivo in sorted((SQL / "clean").glob("*.sql")):
        try:
            con.execute(arquivo.read_text(encoding="utf-8"))
        except duckdb.Error as e:
            execucao.registrar_erro(con, run_id, None, f"{arquivo.name}: {e}", codigo="clean_falhou")


def executar_checagens(con: duckdb.DuckDBPyConnection, run_id: int) -> None:
    """Cada checagem devolve linhas (source_id, gravidade, codigo, mensagem)."""
    for arquivo in sorted((SQL / "checagens").glob("*.sql")):
        try:
            achados = con.execute(arquivo.read_text(encoding="utf-8")).fetchall()
        except duckdb.Error as e:
            execucao.registrar_erro(con, run_id, None, f"{arquivo.name}: {e}", codigo="checagem_falhou")
            continue
        for source_id, gravidade, codigo, mensagem in achados:
            execucao.registrar_erro(con, run_id, source_id, mensagem, codigo=codigo, gravidade=gravidade)
