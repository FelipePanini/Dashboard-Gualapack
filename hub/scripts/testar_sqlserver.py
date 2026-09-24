"""Teste de LEITURA no SQL Server (fase 2): confirma que o script consegue ler a
view de apontamentos com o usuário do Windows, como o Excel já faz.

Só SELECT. Nada é gravado no SQL Server.

    uv run python scripts/testar_sqlserver.py
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pyodbc
import yaml

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))
from hub.coleta import normalizar  # noqa: E402

PREFERIDOS = ["ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server",
              "SQL Server Native Client 11.0", "SQL Server"]


def main() -> None:
    cfg = yaml.safe_load((RAIZ / "config" / "sqlserver.local.yaml").read_text(encoding="utf-8"))
    instalados = pyodbc.drivers()
    driver = next((d for d in PREFERIDOS if d in instalados), None)
    if not driver:
        sys.exit(f"Nenhum driver ODBC de SQL Server instalado. Encontrados: {instalados}")
    print(f"driver: {driver}")

    t = time.time()
    con = pyodbc.connect(
        f"DRIVER={{{driver}}};SERVER={cfg['servidor']};DATABASE={cfg['banco']};"
        "Trusted_Connection=yes;ApplicationIntent=ReadOnly;", timeout=15, readonly=True)
    con.timeout = 120  # tempo máximo por consulta
    print(f"conectou em {time.time() - t:.1f}s")

    cur = con.cursor()
    cur.execute(f"SELECT TOP 5 * FROM {cfg['view_apontamentos']}")
    colunas = [c[0] for c in cur.description]
    print(f"{len(cur.fetchall())} linhas de amostra · {len(colunas)} colunas:")
    print("  ", ", ".join(colunas))

    esperadas = {"num_ordem", "cod_recurso", "cod_apont", "dt_producao", "qtd_horas"}
    faltando = esperadas - {normalizar(c) for c in colunas}
    print("colunas da Base Apontamento presentes na view:", "todas" if not faltando else f"faltam {sorted(faltando)}")

    t = time.time()
    cur.execute(f"SELECT MAX(DtProducao) FROM {cfg['view_apontamentos']}")
    print(f"dado mais recente na view: {cur.fetchone()[0]} ({time.time() - t:.1f}s)")
    con.close()


if __name__ == "__main__":
    main()
