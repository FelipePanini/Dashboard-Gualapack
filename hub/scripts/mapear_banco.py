"""Mapa do banco da fábrica, SÓ LEITURA e só catálogo: quais tabelas e views o
acesso do hub enxerga, as colunas de cada uma (nome e tipo), o número de linhas
das tabelas (pelo catálogo, sem varrer dado) e o texto das views quando o banco
deixa ler. Não lê nenhuma linha de dado — então nada de nome de operador nem
observação.

    .venv\\Scripts\\python.exe scripts\\mapear_banco.py

Saída em data/mapa_banco/ (fora do git): mapa.json e mapa.md.
"""
from __future__ import annotations

import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hub import sqlserver  # noqa: E402
from hub.caminhos import RAIZ  # noqa: E402

SAIDA = RAIZ / "data" / "mapa_banco"

OBJETOS = """
SELECT o.object_id, SCHEMA_NAME(o.schema_id) AS esquema, o.name AS nome,
       CASE o.type WHEN 'U' THEN 'tabela' ELSE 'view' END AS tipo,
       o.create_date, o.modify_date
FROM sys.objects o
WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
  AND HAS_PERMS_BY_NAME(QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), 'OBJECT', 'SELECT') = 1
"""
COLUNAS = """
SELECT c.object_id, c.column_id, c.name, t.name AS tipo, c.max_length, c.precision, c.scale, c.is_nullable
FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id
"""
LINHAS = """
SELECT p.object_id, SUM(p.rows) AS linhas
FROM sys.partitions p WHERE p.index_id IN (0, 1) GROUP BY p.object_id
"""
DEFINICAO = "SELECT OBJECT_DEFINITION(?)"


def consulta(cur, sql, *params):
    cur.execute(sql, *params) if params else cur.execute(sql)
    nomes = [d[0] for d in cur.description]
    return [dict(zip(nomes, linha)) for linha in cur.fetchall()]


def main() -> None:
    t0 = time.time()
    try:
        con = sqlserver.conectar()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"não conectou: {sqlserver.erro_legivel(e)}")
    cur = con.cursor()

    objetos = consulta(cur, OBJETOS)
    ids = {o["object_id"] for o in objetos}
    colunas = defaultdict(list)
    for c in consulta(cur, COLUNAS):
        if c["object_id"] in ids:
            colunas[c["object_id"]].append(c)
    try:
        linhas = {r["object_id"]: int(r["linhas"]) for r in consulta(cur, LINHAS)}
    except Exception:  # noqa: BLE001 — sem permissão no catálogo de partições
        linhas = {}

    mapa = []
    sem_texto = 0
    for o in sorted(objetos, key=lambda x: (x["tipo"], x["esquema"], x["nome"].lower())):
        texto = None
        if o["tipo"] == "view":
            try:
                cur.execute(DEFINICAO, o["object_id"])
                texto = cur.fetchone()[0]
            except Exception:  # noqa: BLE001
                texto = None
            sem_texto += texto is None
        mapa.append({
            "objeto": f"{o['esquema']}.{o['nome']}", "tipo": o["tipo"],
            "criado": str(o["create_date"])[:10], "alterado": str(o["modify_date"])[:10],
            "linhas": linhas.get(o["object_id"]) if o["tipo"] == "tabela" else None,
            "colunas": [{"nome": c["name"], "tipo": c["tipo"], "nulo": bool(c["is_nullable"])}
                        for c in sorted(colunas[o["object_id"]], key=lambda c: c["column_id"])],
            "definicao": texto,
        })
    con.close()

    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / "mapa.json").write_text(json.dumps(mapa, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    tabelas = [m for m in mapa if m["tipo"] == "tabela"]
    views = [m for m in mapa if m["tipo"] == "view"]
    md = [f"# Mapa do banco (só catálogo) — {time.strftime('%d/%m/%Y %H:%M')}", "",
          f"{len(tabelas)} tabelas e {len(views)} views visíveis para o acesso do hub. "
          f"Texto da view legível em {len(views) - sem_texto} de {len(views)}.", ""]
    for titulo, grupo in (("Views", views), ("Tabelas", tabelas)):
        md += [f"## {titulo}", ""]
        for m in grupo:
            extra = f" · {m['linhas']:,} linhas".replace(",", ".") if m["linhas"] is not None else ""
            md.append(f"### {m['objeto']}{extra} · alterado {m['alterado']}")
            md.append(", ".join(f"{c['nome']} ({c['tipo']})" for c in m["colunas"]))
            md.append("")
    (SAIDA / "mapa.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{len(tabelas)} tabelas, {len(views)} views, {sum(len(m['colunas']) for m in mapa)} colunas "
          f"em {time.time() - t0:.0f}s -> {SAIDA}")


if __name__ == "__main__":
    main()
