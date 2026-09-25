"""Catálogo de indicadores -> measurements.

Cada indicador tem várias medições (a da fonte oficial e as de comparação).
Cada medição é um arquivo SQL que devolve: periodo, recorte, valor e,
quando existirem, numerador e denominador (componentes somáveis).
"""
from __future__ import annotations

import json

import duckdb
import polars as pl

from hub import execucao
from hub.db import ler_sql

HUB = "hub.calculo"  # pseudo-fonte: valor calculado pelo hub a partir das bases


def registrar_indicadores(con: duckdb.DuckDBPyConnection, indicadores: list[dict]) -> None:
    for ind in indicadores:
        comparadas = [m["fonte"] for m in ind["medicoes"] if m["fonte"] != ind["fonte_oficial"]]
        con.execute(
            """insert or replace into indicators
               (codigo, versao, nome, unidade, grao, definicao, regra_sql, fonte_oficial,
                fontes_comparadas, comparacao_opcional, tolerancia_abs, tolerancia_pct, dono,
                status_definicao, correcao, faixa_max)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [ind["codigo"], ind["versao"], ind["nome"], ind["unidade"], ind["grao"],
             ind["definicao"].strip(), ";".join(m["regra"] for m in ind["medicoes"]),
             ind["fonte_oficial"], ",".join(comparadas) or None, bool(ind.get("comparacao_opcional")),
             ind.get("tolerancia_abs"), ind.get("tolerancia_pct"), ind.get("dono"),
             ind.get("status_definicao"), ind.get("correcao"), ind.get("faixa_max")],
        )


def _arquivos_usados(con, fontes: list[str]) -> dict[str, dict]:
    """Última versão boa de cada fonte usada — é o que está no RAW agora."""
    usados = {}
    for f in fontes:
        linha = con.execute(
            "select f.id, f.caminho, f.sha256, f.dado_ate, coalesce(s.frescor_dias, 1) from files f "
            "left join sources s on s.id = f.source_id where f.source_id = ? and f.status = 'novo' "
            "order by f.id desc limit 1", [f]).fetchone()
        if linha:
            usados[f] = {"file_id": linha[0], "arquivo": linha[1], "sha256": linha[2][:12],
                         "dado_ate": linha[3], "historico": linha[4] == 0}
    return usados


def _dado_ate(usados: dict[str, dict]):
    """Até quando vai o dado da medição: a fonte que acaba primeiro. Arquivo
    histórico (frescor 0, ex.: o de 2025 junto com o do ano corrente) não
    limita, a não ser que só haja histórico."""
    correntes = [u["dado_ate"] for u in usados.values() if u["dado_ate"] is not None and not u["historico"]]
    todas = [u["dado_ate"] for u in usados.values() if u["dado_ate"] is not None]
    return min(correntes or todas) if todas else None


def calcular(con: duckdb.DuckDBPyConnection, run_id: int, indicadores: list[dict]) -> None:
    for ind in indicadores:
        for med in ind["medicoes"]:
            try:
                df = con.execute(ler_sql(med["regra"])).pl()
                faltando = {"periodo", "recorte", "valor"} - set(df.columns)
                if faltando:
                    raise ValueError(f"regra {med['regra']} não devolveu {sorted(faltando)}")
                for col in ("numerador", "denominador"):
                    if col not in df.columns:
                        df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias(col))

                fontes = med.get("usa") or [med["fonte"]]
                usados = _arquivos_usados(con, fontes)
                file_id = usados[fontes[0]]["file_id"] if len(fontes) == 1 and fontes[0] in usados else None
                linhagem = json.dumps({"regra": med["regra"], "fontes": usados}, default=str, ensure_ascii=False)

                con.register("_med", df)
                con.execute(
                    """insert into measurements (run_id, indicador, versao, source_id, file_id, periodo,
                           recorte, valor, numerador, denominador, dado_ate, linhagem)
                       select ?, ?, ?, ?, ?, cast(periodo as date), cast(recorte as varchar),
                              cast(valor as double), cast(numerador as double), cast(denominador as double),
                              ?, ?::json
                       from _med where periodo is not null""",
                    [run_id, ind["codigo"], ind["versao"], med["fonte"], file_id,
                     _dado_ate(usados), linhagem],
                )
                con.unregister("_med")
            except Exception as e:  # uma regra quebrada não derruba as outras
                execucao.registrar_excecao(con, run_id, med["fonte"], e, codigo="regra_falhou")
