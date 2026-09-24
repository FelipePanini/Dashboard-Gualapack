"""Coletores de Excel: lê a aba, confere o contrato e grava a cópia fiel (RAW).

Regras que existem por causa de falhas reais do pipeline antigo:
- Aba ou coluna obrigatória sumiu -> ContratoQuebrado, e o RAW anterior
  continua valendo. (Em 18/09 uma coluna sumiu e o TMR zerou sem erro.)
- Arquivo igual ao da última leitura (mesmo SHA-256 e mesma regra) não é
  relido; fica registrado como "sem_mudanca", que é como se detecta
  planilha que parou de ser atualizada.
- Sem teto de linhas: o calamine lê 250 mil linhas em ~4 s.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

import duckdb
import fastexcel
import polars as pl

from hub import execucao
from hub.caminhos import RAW
from hub.db import tabela_existe
from hub.origens import ArquivoObtido, Origens, resolver

SNAPSHOTS_POR_FONTE = 30
EXTENSOES_DE_DADOS = {".xlsx", ".xlsm", ".xls", ".csv", ".pbix", ".pbip"}


class ContratoQuebrado(Exception):
    """A planilha mudou de formato: falta aba, âncora, coluna ou linhas."""


# -- nomes -------------------------------------------------------------------
def normalizar(nome: object) -> str:
    """'CodApont' -> 'cod_apont', 'CLASSIFICAÇÃO DISP.' -> 'classificacao_disp'."""
    s = unicodedata.normalize("NFD", str(nome if nome is not None else "")).encode("ascii", "ignore").decode()
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def nomes_unicos(nomes: list[str]) -> list[str]:
    """Cabeçalhos que normalizam igual ('CodApont' e 'Cod_Apont') viram x, x_2..."""
    vistos: dict[str, int] = {}
    saida = []
    for n in nomes:
        n = n or "coluna"
        k = vistos.get(n, 0)
        vistos[n] = k + 1
        saida.append(n if k == 0 else f"{n}_{k + 1}")
    return saida


def tabela_raw(fonte_id: str) -> str:
    return "raw." + fonte_id.replace(".", "__")


# -- leitura -------------------------------------------------------------------
def _garantir_aba(caminho, aba: str) -> None:
    abas = fastexcel.read_excel(str(caminho)).sheet_names
    if aba not in abas:
        raise ContratoQuebrado(f"aba '{aba}' não existe (abas: {', '.join(abas)})")


def ler_tabela(caminho, aba: str) -> pl.DataFrame:
    """Aba de base: cabeçalho na primeira linha."""
    _garantir_aba(caminho, aba)
    df = pl.read_excel(caminho, sheet_name=aba, engine="calamine")
    df.columns = nomes_unicos([normalizar(c) for c in df.columns])
    return df


def _achar(grade: list[tuple], texto: str, lin_min: int = 0, col_min: int = 0) -> tuple[int, int] | None:
    alvo = texto.strip()
    for i in range(lin_min, len(grade)):
        for j in range(col_min, len(grade[i])):
            v = grade[i][j]
            if v is not None and str(v).strip() == alvo:
                return i, j
    return None


def ler_bloco(caminho, aba: str, ancora: str, titulo: str | None = None) -> pl.DataFrame:
    """Tabela pequena dentro de aba de relatório.

    Começa na célula `ancora` (a primeira abaixo/à direita do `titulo`, se
    houver), o cabeçalho vai para a direita até a primeira célula vazia e os
    dados descem até a primeira linha com a coluna da âncora vazia.
    Tudo vem como texto; a conversão de tipo é feita no CLEAN.
    """
    _garantir_aba(caminho, aba)
    # Linhas e colunas vazias PRECISAM ficar: a linha vazia marca o fim do
    # bloco e a coluna vazia separa blocos lado a lado. O padrão do polars
    # é descartar as duas.
    bruto = pl.read_excel(caminho, sheet_name=aba, engine="calamine", has_header=False,
                          infer_schema_length=0, drop_empty_rows=False, drop_empty_cols=False)
    grade = bruto.rows()
    inicio = (0, 0)
    if titulo:
        achado = _achar(grade, titulo)
        if achado is None:
            raise ContratoQuebrado(f"título '{titulo}' não encontrado em [{aba}]")
        inicio = achado
    achado = _achar(grade, ancora, *inicio)
    if achado is None:
        raise ContratoQuebrado(f"âncora '{ancora}' não encontrada em [{aba}]")
    i, j = achado

    cabecalho = []
    for v in grade[i][j:]:
        if v is None or str(v).strip() == "":
            break
        cabecalho.append(v)
    linhas = []
    for linha in grade[i + 1:]:
        primeira = linha[j] if j < len(linha) else None
        if primeira is None or str(primeira).strip() == "":
            break
        linhas.append(tuple(linha[j:j + len(cabecalho)]))
    colunas = nomes_unicos([normalizar(c) for c in cabecalho])
    return pl.DataFrame(linhas, schema={c: pl.String for c in colunas}, orient="row")


def _checar_colunas(fonte: dict, df: pl.DataFrame, onde: str = "") -> None:
    faltando = [c for c in fonte.get("colunas_obrigatorias", []) if c not in df.columns]
    if faltando:
        raise ContratoQuebrado(f"{onde or '[' + str(fonte.get('aba')) + ']'} sem as colunas {faltando}; "
                               f"colunas lidas: {df.columns}")


def ler_fonte(fonte: dict, caminho) -> pl.DataFrame:
    if fonte["tipo"] == "excel_tabela":
        df = ler_tabela(caminho, fonte["aba"])
    elif fonte["tipo"] == "excel_bloco" and "abas" in fonte:
        partes = []
        for recorte, aba in fonte["abas"].items():
            bloco = ler_bloco(caminho, aba, fonte["ancora"], fonte.get("titulo"))
            _checar_colunas(fonte, bloco, onde=f"[{aba}]")
            partes.append(bloco.with_columns(pl.lit(recorte).alias("recorte")))
        df = pl.concat(partes, how="diagonal")  # Laminação/Corte não têm "Inicialização"
    elif fonte["tipo"] == "excel_bloco":
        df = ler_bloco(caminho, fonte["aba"], fonte["ancora"], fonte.get("titulo"))
    else:
        raise ValueError(f"tipo de fonte desconhecido: {fonte['tipo']!r}")

    _checar_colunas(fonte, df)
    minimo = fonte.get("linhas_minimas", 1)
    if df.height < minimo:
        raise ContratoQuebrado(f"[{fonte.get('aba')}] com {df.height} linha(s); mínimo esperado {minimo}")
    return df


# -- metadados do arquivo ------------------------------------------------------
def _hash_config(fonte: dict) -> str:
    return hashlib.sha1(json.dumps(fonte, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def _periodo(fonte: dict, df: pl.DataFrame) -> tuple[date | None, date | None]:
    col = fonte.get("coluna_data")
    if not col or col not in df.columns:
        return None, None
    datas = df.get_column(col).cast(pl.Date, strict=False)
    if fonte.get("data_conta_se"):
        valor = df.get_column(fonte["data_conta_se"]).cast(pl.Float64, strict=False).fill_null(0)
        datas = datas.filter(valor > 0)
    datas = datas.drop_nulls()
    if datas.is_empty():
        return None, None
    de, ate = datas.min(), datas.max()
    if fonte.get("granularidade") == "mensal":  # "2026-08-01" cobre o mês inteiro
        ate = ate.replace(day=calendar.monthrange(ate.year, ate.month)[1])
    return de, ate


def _registrar(con, run_id: int, fonte: dict, obtido: ArquivoObtido, status: str,
               df: pl.DataFrame | None = None) -> int:
    linhas = assinatura = de = ate = None
    if df is not None:
        linhas = df.height
        assinatura = hashlib.sha1("|".join(df.columns).encode()).hexdigest()[:12]
        de, ate = _periodo(fonte, df)
    return con.execute(
        """insert into files (source_id, run_id, caminho, sha256, config_hash, tamanho_bytes,
                              modificado_em, linhas, assinatura_colunas, dado_de, dado_ate, status)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""",
        [fonte["id"], run_id, obtido.descricao, obtido.sha256, _hash_config(fonte),
         obtido.caminho.stat().st_size, obtido.modificado_em, linhas, assinatura, de, ate, status],
    ).fetchone()[0]


def sincronizar_fontes(con: duckdb.DuckDBPyConnection, fontes: list[dict]) -> None:
    """O catálogo de fontes do banco espelha o YAML a cada execução."""
    con.execute("update sources set ativa = false")
    for f in fontes:
        con.execute(
            "insert or replace into sources (id, tipo, descricao, dono, frescor_dias, ativa) "
            "values (?, ?, ?, ?, ?, true)",
            [f["id"], f["tipo"], f.get("descricao"), f.get("dono"), int(f.get("frescor_dias", 1))],
        )


def inventariar_pasta(con: duckdb.DuckDBPyConnection, run_id: int, pasta: Path | None, fontes: list[dict]) -> None:
    """Arquivo deixado na pasta de entrada que nenhuma fonte usa vira aviso no
    relatório: é assim que uma planilha ou um BI novo aparece pra ser catalogado."""
    if pasta is None:
        return
    if not pasta.exists():
        execucao.registrar_erro(con, run_id, None, f"a pasta de entrada não existe: {pasta}",
                                codigo="pasta_ausente")
        return
    usados = set()
    for fonte in fontes:
        try:
            usados.add(resolver(fonte["arquivo"]).resolve())
        except FileNotFoundError:
            pass  # a coleta já registra arquivo ausente
    for arq in sorted(pasta.iterdir()):
        if (not arq.is_file() or arq.name.startswith("~$")
                or arq.suffix.lower() not in EXTENSOES_DE_DADOS or arq.resolve() in usados):
            continue
        if arq.suffix.lower() == ".pbix":
            mensagem = (f"'{arq.name}' é um arquivo do Power BI, que o hub não lê. Para usar os números, "
                        "exporte os dados do visual para Excel/CSV nesta pasta; para usar as regras, "
                        "salve como projeto do Power BI (.pbip).")
        else:
            mensagem = f"'{arq.name}' está na pasta de entrada, mas ainda não está no catálogo de fontes."
        execucao.registrar_erro(con, run_id, None, mensagem, codigo="arquivo_nao_catalogado", gravidade="aviso")


# -- coleta ----------------------------------------------------------------------
def coletar(con: duckdb.DuckDBPyConnection, run_id: int, fonte: dict, origens: Origens) -> str:
    """Devolve o status do arquivo: 'novo' ou 'sem_mudanca'. Contrato quebrado levanta."""
    obtido = origens.obter(fonte)
    tabela = tabela_raw(fonte["id"])

    ultimo = con.execute(
        "select sha256, config_hash from files where source_id = ? and status in ('novo', 'sem_mudanca') "
        "order by id desc limit 1", [fonte["id"]]).fetchone()
    if ultimo == (obtido.sha256, _hash_config(fonte)) and tabela_existe(con, tabela):
        _registrar(con, run_id, fonte, obtido, "sem_mudanca")
        return "sem_mudanca"

    try:
        df = ler_fonte(fonte, obtido.caminho)
    except ContratoQuebrado:
        _registrar(con, run_id, fonte, obtido, "contrato_quebrado")
        raise  # o RAW anterior continua lá: melhor dado de ontem que dado errado

    file_id = _registrar(con, run_id, fonte, obtido, "novo", df)
    df = df.with_columns(pl.lit(file_id).alias("_arquivo_id"))
    con.register("_novo", df)
    con.execute(f"create or replace table {tabela} as select * from _novo")
    con.unregister("_novo")

    pasta = RAW / fonte["id"]
    pasta.mkdir(parents=True, exist_ok=True)
    df.write_parquet(pasta / f"{obtido.sha256[:16]}.parquet")
    for antigo in sorted(pasta.glob("*.parquet"), key=lambda p: p.stat().st_mtime)[:-SNAPSHOTS_POR_FONTE]:
        antigo.unlink()
    return "novo"
