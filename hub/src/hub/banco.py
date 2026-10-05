"""Extração do banco da fábrica (SQL Server, banco Metrics), só leitura.

Hoje o conector é o próprio Excel: ele usa o login de banco que já está salvo
nele (ninguém precisa saber a senha), puxa um mês por vez da view de
apontamentos, filtrado no banco, e o hub guarda um parquet por mês em
banco.pasta. Quando o TI liberar leitura direta, só troca o conector.

Cada execução relê os meses mais recentes (banco.reextrair_meses) e os que
ainda não têm arquivo; o arquivo de um mês só é substituído quando o dado
mudou de verdade (mesmas linhas, mesma ordem = nada muda e a coleta não
reprocessa). A fonte banco.apontamentos (fontes.local.yaml) empilha os meses.

Só as colunas que as planilhas e os BIs usam; nunca nome de operador nem
observação livre.
"""
from __future__ import annotations

import logging
import subprocess
import tempfile
import time
from datetime import date
from pathlib import Path

import polars as pl

from hub.caminhos import RAIZ
from hub.coleta import nomes_unicos, normalizar

log = logging.getLogger("hub")

VIEW = "View_usr_apontamentos_999999"
COLUNAS = ["IdApontamento", "NumOrdem", "CodRecurso", "CodApont", "Cod_Apont", "Cod_Desc", "DtProducao", "HoraInicio",
           "HoraFim", "QtdHoras", "QtdProduzida", "Turno", "TipoProduto", "Des_NumOrdem", "Descricao", "CodEst",
           "CodEstrutura", "Processo", "Classificacao", "CodAtiv", "DesperdicioAcerto", "DesperdicioVirando",
           "usr_PesoBrutoBobina", "usr_Bobina", "usr_grupofiltro", "usr_kgdaperda", "usr_tipodaperda",
           "DtInclusao", "DtAlteracao"]
DATAS = ["dt_producao", "hora_inicio", "hora_fim", "dt_inclusao", "dt_alteracao"]
NUMEROS = ["qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando", "usr_peso_bruto_bobina", "usr_kgdaperda"]
SEGUNDOS_POR_MES = 90


def _meses(desde: date, ate: date) -> list[date]:
    m, saida = date(desde.year, desde.month, 1), []
    while m <= ate:
        saida.append(m)
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return saida


def arquivo_do_mes(pasta: Path, mes: date) -> Path:
    return pasta / f"apontamentos_{mes:%Y-%m}.parquet"


def meses_para_extrair(desde: date, pasta: Path, reextrair: int, hoje: date) -> list[date]:
    todos = _meses(desde, hoje)
    recentes = set(todos[-reextrair:]) if reextrair > 0 else set()
    return [m for m in todos if m in recentes or not arquivo_do_mes(pasta, m).exists()]


def m_do_mes(servidor: str, mes: date) -> str:
    fim = date(mes.year + (mes.month == 12), mes.month % 12 + 1, 1)
    lista = ", ".join(f'"{c}"' for c in COLUNAS)
    return f"""let
    Fonte = Sql.Database("{servidor}", "Metrics"),
    V = Fonte{{[Schema="dbo",Item="{VIEW}"]}}[Data],
    Mes = Table.SelectRows(V, each [DtProducao] >= #datetime({mes.year}, {mes.month}, 1, 0, 0, 0) and [DtProducao] < #datetime({fim.year}, {fim.month}, 1, 0, 0, 0)),
    Colunas = Table.SelectColumns(Mes, {{{lista}}})
in
    Colunas"""


def padronizar(df: pl.DataFrame) -> pl.DataFrame:
    """Nomes normalizados, tipos fixos (o mesmo esquema em todos os meses) e
    ordem estável (pelo id do apontamento), pra comparar uma extração com a outra."""
    df = df.rename(dict(zip(df.columns, nomes_unicos([normalizar(c) for c in df.columns]))))
    df = df.with_columns(
        [pl.col(c).str.to_datetime(strict=False) for c in DATAS if c in df.columns]
        + [pl.col(c).cast(pl.Float64, strict=False) for c in NUMEROS if c in df.columns])
    return df.sort(pl.col("id_apontamento").cast(pl.Int64, strict=False), "id_apontamento")


def _rodar_excel(spec: list[dict], saida: Path) -> dict[str, str]:
    import json
    with tempfile.TemporaryDirectory() as tmp:
        arq_spec = Path(tmp) / "consultas.json"
        arq_spec.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            str(RAIZ / "scripts" / "extrair_excel.ps1"), "-Spec", str(arq_spec), "-Saida", str(saida)],
                           capture_output=True, text=True, timeout=60 + SEGUNDOS_POR_MES * len(spec),
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    resultado = {}
    for linha in r.stdout.splitlines():
        partes = linha.split("\t")
        if len(partes) >= 3 and partes[0] in ("ok", "ERRO"):
            resultado[partes[1]] = "ok" if partes[0] == "ok" else partes[2]
    if not resultado:
        raise RuntimeError(f"o Excel não devolveu nada ({r.returncode}): {(r.stderr or r.stdout).strip()[:300]}")
    return resultado


def extrair(cfg: dict, hoje: date | None = None) -> tuple[list[str], list[str]]:
    """Atualiza os parquets mensais. Devolve (meses que mudaram, avisos)."""
    b = cfg.get("banco") or {}
    if not b.get("ativo"):
        return [], []
    pasta = Path(b["pasta"])
    pasta.mkdir(parents=True, exist_ok=True)
    hoje = hoje or date.today()
    desde = date.fromisoformat(str(b.get("desde", "2025-01")) + "-01")
    meses = meses_para_extrair(desde, pasta, int(b.get("reextrair_meses", 2)), hoje)
    if not meses:
        return [], []
    servidor = b["servidor"]  # só no fontes.local.yaml: o repositório é público
    spec = [{"nome": f"m{m:%Y_%m}", "m": m_do_mes(servidor, m)} for m in meses]
    mudaram, avisos = [], []
    t = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        saida = Path(tmp) / "extracao.xlsx"
        try:
            resultado = _rodar_excel(spec, saida)
        except Exception as e:  # sem Excel/sem rede: fica o que já foi extraído
            return [], [f"extração do banco não rodou: {e}"]
        for m in meses:
            nome = f"m{m:%Y_%m}"
            if resultado.get(nome) != "ok":
                avisos.append(f"{m:%m/%Y}: o banco não respondeu ({resultado.get(nome, 'sem retorno')[:200]})")
                continue
            novo = padronizar(pl.read_excel(saida, sheet_name=nome, engine="calamine", infer_schema_length=0))
            destino = arquivo_do_mes(pasta, m)
            if novo.height == 0 and m < date(hoje.year, hoje.month, 1):
                avisos.append(f"{m:%m/%Y}: o banco devolveu o mês vazio; mantive o arquivo anterior")
                continue
            if destino.exists() and pl.read_parquet(destino).equals(novo):
                continue
            temporario = destino.with_suffix(".tmp")
            novo.write_parquet(temporario)
            temporario.replace(destino)
            mudaram.append(f"{m:%m/%Y} ({novo.height} linhas)")
    log.info("banco: %d mês(es) lido(s) em %.0fs; mudaram: %s", len(meses), time.time() - t, ", ".join(mudaram) or "nenhum")
    return mudaram, avisos
