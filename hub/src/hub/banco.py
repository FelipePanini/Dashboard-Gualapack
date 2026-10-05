"""Extração do banco da fábrica (SQL Server, banco Metrics), só leitura.

Desde 05/10/2026 o hub lê DIRETO do banco (hub/sqlserver.py), com o usuário
de leitura que o TI liberou, guardado no Cofre de Credenciais do Windows. Um
mês por vez da view de apontamentos, filtrado no banco; o hub guarda um
parquet por mês em banco.pasta. Conferido antes da troca: os 22 meses de
jan/2025 a out/2026 saíram idênticos, linha a linha, ao que o conector do
Excel extraía — a única diferença é a "data zero" do banco (30/12/1899), que
o Excel deslocava um dia.

O Excel continua como reserva: se a conexão direta falhar (senha trocada,
rede), o hub avisa e usa o login de banco salvo no Excel. banco.conector =
"excel" no fontes.local.yaml força o caminho antigo.

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
from decimal import Decimal
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
COLUNAS_DATA = {"DtProducao", "HoraInicio", "HoraFim", "DtInclusao", "DtAlteracao"}
DATAS = ["dt_producao", "hora_inicio", "hora_fim", "dt_inclusao", "dt_alteracao"]
NUMEROS = ["qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando", "usr_peso_bruto_bobina", "usr_kgdaperda"]
SEGUNDOS_POR_MES = 90


def _meses(desde: date, ate: date) -> list[date]:
    m, saida = date(desde.year, desde.month, 1), []
    while m <= ate:
        saida.append(m)
        m = _proximo(m)
    return saida


def _proximo(mes: date) -> date:
    return date(mes.year + (mes.month == 12), mes.month % 12 + 1, 1)


def arquivo_do_mes(pasta: Path, mes: date) -> Path:
    return pasta / f"apontamentos_{mes:%Y-%m}.parquet"


def meses_para_extrair(desde: date, pasta: Path, reextrair: int, hoje: date) -> list[date]:
    todos = _meses(desde, hoje)
    recentes = set(todos[-reextrair:]) if reextrair > 0 else set()
    return [m for m in todos if m in recentes or not arquivo_do_mes(pasta, m).exists()]


def padronizar(df: pl.DataFrame) -> pl.DataFrame:
    """Nomes normalizados, tipos fixos (o mesmo esquema em todos os meses) e
    ordem estável (pelo id do apontamento), pra comparar uma extração com a outra."""
    df = df.rename(dict(zip(df.columns, nomes_unicos([normalizar(c) for c in df.columns]))))
    df = df.with_columns(
        [(pl.col(c).str.to_datetime(strict=False) if df.schema[c] == pl.String else pl.col(c).cast(pl.Datetime("us")))
         for c in DATAS if c in df.columns]
        + [pl.col(c).cast(pl.Float64, strict=False) for c in NUMEROS if c in df.columns])
    return df.sort(pl.col("id_apontamento").cast(pl.Int64, strict=False), "id_apontamento")


# ---------- conector direto (padrão) ----------
def _texto(v) -> str | None:
    """Valor do driver como o texto que o conector do Excel gravava: inteiro sem
    ".0", decimal sem zeros à direita, texto com os espaços do campo fixo."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    return str(v)


def quadro_sql(nomes: list[str], linhas: list) -> pl.DataFrame:
    """Linhas do driver -> o mesmo quadro que o conector do Excel produzia."""
    dados = {n: ([r[i] for r in linhas] if n in COLUNAS_DATA else [_texto(r[i]) for r in linhas])
             for i, n in enumerate(nomes)}
    esquema = {n: (pl.Datetime("us") if n in COLUNAS_DATA else pl.String) for n in nomes}
    return padronizar(pl.DataFrame(dados, schema=esquema))


def _ler_sql(meses: list[date]) -> dict[date, pl.DataFrame | str]:
    from hub import sqlserver
    con = sqlserver.conectar()
    try:
        cur = con.cursor()
        colunas = ", ".join(f"[{c}]" for c in COLUNAS)
        saida: dict[date, pl.DataFrame | str] = {}
        for m in meses:
            try:
                cur.execute(f"SELECT {colunas} FROM dbo.{VIEW} WHERE DtProducao >= ? AND DtProducao < ?", (m, _proximo(m)))
                saida[m] = quadro_sql([d[0] for d in cur.description], cur.fetchall())
            except Exception as e:  # noqa: BLE001 — um mês com erro não derruba os outros
                saida[m] = sqlserver.erro_legivel(e)
        return saida
    finally:
        con.close()


# ---------- conector do Excel (reserva) ----------
def m_do_mes(servidor: str, mes: date) -> str:
    fim = _proximo(mes)
    lista = ", ".join(f'"{c}"' for c in COLUNAS)
    return f"""let
    Fonte = Sql.Database("{servidor}", "Metrics"),
    V = Fonte{{[Schema="dbo",Item="{VIEW}"]}}[Data],
    Mes = Table.SelectRows(V, each [DtProducao] >= #datetime({mes.year}, {mes.month}, 1, 0, 0, 0) and [DtProducao] < #datetime({fim.year}, {fim.month}, 1, 0, 0, 0)),
    Colunas = Table.SelectColumns(Mes, {{{lista}}})
in
    Colunas"""


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


def _ler_excel(servidor: str, meses: list[date]) -> dict[date, pl.DataFrame | str]:
    spec = [{"nome": f"m{m:%Y_%m}", "m": m_do_mes(servidor, m)} for m in meses]
    saida: dict[date, pl.DataFrame | str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "extracao.xlsx"
        resultado = _rodar_excel(spec, arq)
        for m in meses:
            nome = f"m{m:%Y_%m}"
            saida[m] = (padronizar(pl.read_excel(arq, sheet_name=nome, engine="calamine", infer_schema_length=0))
                        if resultado.get(nome) == "ok" else resultado.get(nome, "sem retorno"))
    return saida


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
    mudaram, avisos = [], []
    t = time.time()
    lidos, conector = None, b.get("conector", "sql")
    if conector == "sql":
        try:
            lidos = _ler_sql(meses)
        except Exception as e:  # noqa: BLE001 — sem conexão direta: o Excel é a reserva
            from hub import sqlserver
            avisos.append(f"leitura direta do banco falhou ({sqlserver.erro_legivel(e)}); usei o Excel como reserva")
            conector = "excel"
    if lidos is None:
        try:
            lidos = _ler_excel(b["servidor"], meses)  # servidor só no fontes.local.yaml: o repositório é público
        except Exception as e:  # sem Excel/sem rede: fica o que já foi extraído
            return [], avisos + [f"extração do banco não rodou: {e}"]
    for m in meses:
        novo = lidos.get(m, "sem retorno")
        if isinstance(novo, str):
            avisos.append(f"{m:%m/%Y}: o banco não respondeu ({novo[:200]})")
            continue
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
    log.info("banco (%s): %d mês(es) lido(s) em %.0fs; mudaram: %s", conector, len(meses), time.time() - t,
             ", ".join(mudaram) or "nenhum")
    return mudaram, avisos
