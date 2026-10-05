"""Teste de LEITURA direta no SQL Server com a conta do Windows: rode quando o
TI liberar o acesso (db_datareader no Metrics). Só SELECT.

    .venv\\Scripts\\python.exe scripts\\testar_sqlserver.py
"""
from __future__ import annotations

import sys
import time

from hub import sqlserver


def main() -> None:
    t = time.time()
    try:
        con = sqlserver.conectar()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"não conectou: {sqlserver.erro_legivel(e)}")
    print(f"conectou em {time.time() - t:.1f}s")
    cur = con.cursor()
    view = sqlserver.config().get("view_apontamentos", "dbo.View_usr_apontamentos_999999")
    t = time.time()
    cur.execute(f"SELECT COUNT(*), MAX(DtProducao) FROM {view} WHERE DtProducao >= DATEADD(day, -30, GETDATE())")
    n, ultimo = cur.fetchone()
    print(f"últimos 30 dias: {n} apontamentos, o mais recente em {ultimo} ({time.time() - t:.1f}s)")
    con.close()


if __name__ == "__main__":
    main()
