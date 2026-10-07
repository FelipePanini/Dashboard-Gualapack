"""Extração dos apontamentos do banco da fábrica (SQL Server, banco Metrics),
só leitura (hub/sqlserver.py: a trava recusa qualquer comando que não seja
SELECT).

Um mês por vez da view de apontamentos, filtrado no banco; o hub guarda um
parquet por mês em banco.pasta. Conferido antes de trocar o conector do
Excel pela leitura direta (05/10/2026): os 22 meses de jan/2025 a out/2026
saíram idênticos, linha a linha, ao que o Excel extraía — a única diferença é
a "data zero" do banco (30/12/1899), que o Excel deslocava um dia.

Cada execução relê os meses mais recentes (banco.reextrair_meses) e os que
ainda não têm arquivo; o arquivo de um mês só é substituído quando o dado
mudou de verdade (mesmas linhas, mesma ordem = nada muda e a coleta não
reprocessa). A fonte banco.apontamentos (fontes.local.yaml) empilha os meses.

Só as colunas que as regras usam; nunca nome de operador nem observação livre.
As outras extrações do banco (máquinas agora, programação, WIP, carteira,
entregas, setup, laudos) ficam em hub/extracoes.py.
"""
from __future__ import annotations

import logging
import time
from datetime import date
from decimal import Decimal
from pathlib import Path

import polars as pl

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


def _meses(desde: date, ate: date) -> list[date]:
    m, saida = date(desde.year, desde.month, 1), []
    while m <= ate:
        saida.append(m)
        m = proximo_mes(m)
    return saida


def proximo_mes(mes: date) -> date:
    return date(mes.year + (mes.month == 12), mes.month % 12 + 1, 1)


def arquivo_do_mes(pasta: Path, mes: date, nome: str = "apontamentos") -> Path:
    return pasta / f"{nome}_{mes:%Y-%m}.parquet"


def meses_para_extrair(desde: date, pasta: Path, reextrair: int, hoje: date, nome: str = "apontamentos") -> list[date]:
    todos = _meses(desde, hoje)
    recentes = set(todos[-reextrair:]) if reextrair > 0 else set()
    return [m for m in todos if m in recentes or not arquivo_do_mes(pasta, m, nome).exists()]


def padronizar(df: pl.DataFrame) -> pl.DataFrame:
    """Nomes normalizados, tipos fixos (o mesmo esquema em todos os meses) e
    ordem estável (pelo id do apontamento), pra comparar uma extração com a outra."""
    df = df.rename(dict(zip(df.columns, nomes_unicos([normalizar(c) for c in df.columns]))))
    df = df.with_columns(
        [(pl.col(c).str.to_datetime(strict=False) if df.schema[c] == pl.String else pl.col(c).cast(pl.Datetime("us")))
         for c in DATAS if c in df.columns]
        + [pl.col(c).cast(pl.Float64, strict=False) for c in NUMEROS if c in df.columns])
    return df.sort(pl.col("id_apontamento").cast(pl.Int64, strict=False), "id_apontamento")


def texto(v) -> str | None:
    """Valor do driver como texto estável: inteiro sem ".0", decimal sem zeros
    à direita, texto com os espaços do campo fixo (é o que o conector do Excel
    gravava, e o que as regras esperam)."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, Decimal):
        return format(v.normalize(), "f")
    return str(v)


def quadro_sql(nomes: list[str], linhas: list) -> pl.DataFrame:
    """Linhas do driver -> o quadro padronizado dos apontamentos."""
    dados = {n: ([r[i] for r in linhas] if n in COLUNAS_DATA else [texto(r[i]) for r in linhas])
             for i, n in enumerate(nomes)}
    esquema = {n: (pl.Datetime("us") if n in COLUNAS_DATA else pl.String) for n in nomes}
    return padronizar(pl.DataFrame(dados, schema=esquema))


def _ler_meses(meses: list[date]) -> dict[date, pl.DataFrame | str]:
    from hub import sqlserver
    con = sqlserver.conectar()
    try:
        colunas = ", ".join(f"[{c}]" for c in COLUNAS)
        saida: dict[date, pl.DataFrame | str] = {}
        sql = f"SELECT {colunas} FROM dbo.{VIEW} WHERE DtProducao >= ? AND DtProducao < ?"
        for m in meses:
            try:
                saida[m] = quadro_sql(*sqlserver.consultar(con, sql, (m, proximo_mes(m))))
            except sqlserver.ComandoRecusado:
                raise
            except Exception as e:  # noqa: BLE001 — um mês com erro não derruba os outros
                saida[m] = sqlserver.erro_legivel(e)
        return saida
    finally:
        con.close()


def gravar_se_mudou(destino: Path, novo: pl.DataFrame) -> bool:
    """Grava só quando o dado mudou (mesmas linhas, mesma ordem = nada muda,
    e a coleta não reprocessa). A troca é atômica: grava ao lado e renomeia."""
    if destino.exists() and pl.read_parquet(destino).equals(novo):
        return False
    temporario = destino.with_suffix(".tmp")
    novo.write_parquet(temporario)
    temporario.replace(destino)
    return True


def extrair(cfg: dict, hoje: date | None = None) -> tuple[list[str], list[str]]:
    """Atualiza os parquets mensais dos apontamentos. Devolve (meses que mudaram, avisos)."""
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
    try:
        lidos = _ler_meses(meses)
    except Exception as e:  # noqa: BLE001 — sem conexão: fica o que já foi extraído
        from hub import sqlserver
        return [], [f"leitura do banco não rodou ({sqlserver.erro_legivel(e)}); os dados já extraídos continuam valendo"]
    for m in meses:
        novo = lidos.get(m, "sem retorno")
        if isinstance(novo, str):
            avisos.append(f"{m:%m/%Y}: o banco não respondeu ({novo[:200]})")
            continue
        if novo.height == 0 and m < date(hoje.year, hoje.month, 1):
            avisos.append(f"{m:%m/%Y}: o banco devolveu o mês vazio; mantive o arquivo anterior")
            continue
        if gravar_se_mudou(arquivo_do_mes(pasta, m), novo):
            mudaram.append(f"{m:%m/%Y} ({novo.height} linhas)")
    log.info("banco: %d mês(es) de apontamentos lido(s) em %.0fs; mudaram: %s", len(meses), time.time() - t,
             ", ".join(mudaram) or "nenhum")
    return mudaram, avisos
