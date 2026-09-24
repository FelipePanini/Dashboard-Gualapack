"""Coletores: lê a aba (Excel) ou a tabela (Power BI), confere o contrato e
grava a cópia fiel (RAW).

Regras que existem por causa de falhas reais:
- Aba, tabela ou coluna obrigatória sumiu -> ContratoQuebrado, e o RAW
  anterior continua valendo. (Em 18/09 uma coluna sumiu e o TMR zerou sem erro.)
- Arquivo com mesmo tamanho e data de modificação da última leitura (e a
  mesma regra de leitura) não é nem copiado: fica "sem_mudanca". Planilha que
  para de ser atualizada aparece assim no relatório.
- A leitura roda num PROCESSO SEPARADO. O leitor rápido de Excel (calamine,
  código nativo) derruba o processo inteiro em alguns arquivos — aconteceu
  com "Refugo Aparas.xlsx". Isolado, só a leitura cai; o hub tenta de novo
  com o leitor alternativo (openpyxl, mais lento) e registra um aviso.
- Colunas com dado pessoal (nome de operador) são descartadas na leitura,
  antes de chegar ao banco ("colunas_excluir").
"""
from __future__ import annotations

import calendar
import hashlib
import json
import multiprocessing
import re
import tempfile
import unicodedata
from datetime import date
from pathlib import Path

import duckdb
import polars as pl

from hub import execucao
from hub.caminhos import RAW
from hub.db import tabela_existe
from hub.origens import Origens, localizar

SNAPSHOTS_POR_FONTE = 10
EXTENSOES_DE_DADOS = {".xlsx", ".xlsm", ".xls", ".csv", ".pbix", ".pbip"}
TEMPO_MAXIMO_LEITURA_S = 15 * 60
_CTX = multiprocessing.get_context("spawn")


class ContratoQuebrado(Exception):
    """O arquivo mudou de formato: falta aba, tabela, âncora, coluna ou linhas."""


class LeituraFalhou(Exception):
    """Não foi possível ler o arquivo com nenhum leitor."""


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


# -- leitura de Excel ------------------------------------------------------------
def _abas(caminho, motor: str) -> list[str]:
    if motor == "openpyxl":
        import openpyxl
        wb = openpyxl.load_workbook(caminho, read_only=True)
        try:
            return list(wb.sheetnames)
        finally:
            wb.close()
    import fastexcel
    return list(fastexcel.read_excel(str(caminho)).sheet_names)


def _garantir_aba(caminho, aba: str, motor: str) -> None:
    abas = _abas(caminho, motor)
    if aba not in abas:
        raise ContratoQuebrado(f"aba '{aba}' não existe (abas: {', '.join(abas)})")


def ler_tabela(caminho, aba: str, motor: str = "calamine") -> pl.DataFrame:
    """Aba de base: cabeçalho na primeira linha."""
    _garantir_aba(caminho, aba, motor)
    df = pl.read_excel(caminho, sheet_name=aba, engine=motor)
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


def ler_bloco(caminho, aba: str, ancora: str, titulo: str | None = None, motor: str = "calamine") -> pl.DataFrame:
    """Tabela pequena dentro de aba de relatório.

    Começa na célula `ancora` (a primeira abaixo/à direita do `titulo`, se
    houver), o cabeçalho vai para a direita até a primeira célula vazia e os
    dados descem até a primeira linha com a coluna da âncora vazia.
    Tudo vem como texto; a conversão de tipo é feita no CLEAN.
    """
    _garantir_aba(caminho, aba, motor)
    # Linhas e colunas vazias PRECISAM ficar: a linha vazia marca o fim do
    # bloco e a coluna vazia separa blocos lado a lado. O padrão do polars
    # é descartar as duas.
    bruto = pl.read_excel(caminho, sheet_name=aba, engine=motor, has_header=False,
                          infer_schema_length=0, drop_empty_rows=False, drop_empty_cols=False)
    grade = [tuple(None if v is None else str(v) for v in linha) for linha in bruto.rows()]
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
        if v is None or v.strip() == "":
            break
        cabecalho.append(v)
    linhas = []
    for linha in grade[i + 1:]:
        primeira = linha[j] if j < len(linha) else None
        if primeira is None or primeira.strip() == "":
            break
        linhas.append(tuple(linha[j:j + len(cabecalho)]))
    colunas = nomes_unicos([normalizar(c) for c in cabecalho])
    return pl.DataFrame(linhas, schema={c: pl.String for c in colunas}, orient="row")


# -- leitura de Power BI -----------------------------------------------------------
def ler_pbix(caminho, fonte: dict) -> pl.DataFrame:
    """Tabela do modelo importado dentro do .pbix (sem Power BI e sem banco).

    O dado é o da última vez que alguém atualizou e salvou o .pbix."""
    from pbixray import PBIXRay

    modelo = PBIXRay(str(caminho))
    if fonte.get("conteudo") == "medidas":
        pdf = modelo.dax_measures
    else:
        tabelas = list(modelo.tables)
        if fonte["tabela"] not in tabelas:
            raise ContratoQuebrado(f"tabela '{fonte['tabela']}' não existe no modelo do BI")
        pdf = modelo.get_table(fonte["tabela"])
    for col in pdf.columns:  # colunas de texto misto não convertem direto pro polars
        if pdf[col].dtype == object:
            pdf[col] = pdf[col].astype("string")
    df = pl.from_pandas(pdf)
    df.columns = nomes_unicos([normalizar(c) for c in df.columns])
    return df


# -- contrato ------------------------------------------------------------------------
def _checar_colunas(fonte: dict, df: pl.DataFrame, onde: str = "") -> None:
    faltando = [c for c in fonte.get("colunas_obrigatorias", []) if c not in df.columns]
    if faltando:
        onde = onde or f"[{fonte.get('aba') or fonte.get('tabela') or fonte['id']}]"
        raise ContratoQuebrado(f"{onde} sem as colunas {faltando}; colunas lidas: {df.columns}")


def ler_fonte(fonte: dict, caminho, motor: str = "calamine") -> pl.DataFrame:
    if fonte["tipo"] == "pbix":
        df = ler_pbix(caminho, fonte)
    elif fonte["tipo"] == "excel_tabela":
        df = ler_tabela(caminho, fonte["aba"], motor)
    elif fonte["tipo"] == "excel_bloco" and "abas" in fonte:
        partes = []
        for recorte, aba in fonte["abas"].items():
            bloco = ler_bloco(caminho, aba, fonte["ancora"], fonte.get("titulo"), motor)
            _checar_colunas(fonte, bloco, onde=f"[{aba}]")
            partes.append(bloco.with_columns(pl.lit(recorte).alias("recorte")))
        df = pl.concat(partes, how="diagonal")  # Laminação/Corte não têm "Inicialização"
    elif fonte["tipo"] == "excel_bloco":
        df = ler_bloco(caminho, fonte["aba"], fonte["ancora"], fonte.get("titulo"), motor)
    else:
        raise ValueError(f"tipo de fonte desconhecido: {fonte['tipo']!r}")

    excluir = [c for c in fonte.get("colunas_excluir", []) if c in df.columns]
    if excluir:
        df = df.drop(excluir)
    _checar_colunas(fonte, df)
    minimo = fonte.get("linhas_minimas", 1)
    if df.height < minimo:
        raise ContratoQuebrado(f"[{fonte.get('aba') or fonte.get('tabela')}] com {df.height} linha(s); "
                               f"mínimo esperado {minimo}")
    return df


# -- leitura isolada em outro processo ----------------------------------------------------
def _filho_ler(fonte: dict, caminhos: list[str], saida: str, motor: str) -> None:
    """Roda no processo filho. Grava o resultado em parquet, ou o erro num .erro."""
    import os
    if fonte.get("_teste_travar_motor") == motor:  # só pros testes: simula o leitor nativo caindo
        os._exit(3)
    try:
        partes = []
        for caminho in caminhos:
            df = ler_fonte(fonte, Path(caminho), motor)
            if len(caminhos) > 1:
                df = df.with_columns(pl.lit(Path(caminho).name).alias("_arquivo"))
            partes.append(df)
        df = pl.concat(partes, how="diagonal_relaxed") if len(partes) > 1 else partes[0]
        df.write_parquet(saida)
    except ContratoQuebrado as e:
        Path(saida + ".erro").write_text("contrato\n" + str(e), encoding="utf-8")
    except Exception as e:
        Path(saida + ".erro").write_text(f"erro\n{type(e).__name__}: {e}", encoding="utf-8")


def ler_isolado(fonte: dict, caminhos: list[Path]) -> tuple[pl.DataFrame, str]:
    """Lê a fonte num processo filho; devolve (dados, leitor usado)."""
    motores = ["pbix"] if fonte["tipo"] == "pbix" else ["calamine", "openpyxl"]
    codigo = None
    for motor in motores:
        with tempfile.TemporaryDirectory() as tmp:
            saida = str(Path(tmp) / "leitura.parquet")
            p = _CTX.Process(target=_filho_ler, args=(fonte, [str(c) for c in caminhos], saida, motor))
            p.start()
            p.join(TEMPO_MAXIMO_LEITURA_S)
            if p.is_alive():
                p.kill()
                p.join()
                raise LeituraFalhou(f"a leitura passou de {TEMPO_MAXIMO_LEITURA_S // 60} min")
            erro = Path(saida + ".erro")
            if erro.exists():
                tipo, mensagem = erro.read_text(encoding="utf-8").split("\n", 1)
                raise (ContratoQuebrado if tipo == "contrato" else LeituraFalhou)(mensagem)
            if p.exitcode == 0 and Path(saida).exists():
                return pl.read_parquet(saida), motor
            codigo = p.exitcode  # o leitor nativo caiu sem conseguir registrar erro: tenta o próximo
    raise LeituraFalhou(f"o leitor caiu ao abrir o arquivo (código {codigo})")


# -- metadados do arquivo ------------------------------------------------------------
def _hash_config(fonte: dict) -> str:
    return hashlib.sha1(json.dumps(fonte, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def _assinatura_origem(originais: list[Path]) -> str:
    """Nome + tamanho + data de modificação: muda quando o arquivo é salvo de novo."""
    partes = []
    for p in originais:
        st = p.stat()
        partes.append(f"{p.name}:{st.st_size}:{st.st_mtime_ns}")
    return hashlib.sha1("|".join(partes).encode()).hexdigest()[:16]


def _periodo(fonte: dict, df: pl.DataFrame) -> tuple[date | None, date | None]:
    col = fonte.get("coluna_data")
    if not col or col not in df.columns:
        return None, None
    serie = df.get_column(col)
    if serie.dtype == pl.String and fonte.get("formato_data"):
        datas = serie.str.strptime(pl.Datetime, fonte["formato_data"], strict=False).dt.date()
    else:
        datas = serie.cast(pl.Date, strict=False)
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


def _registrar(con, run_id: int, fonte: dict, status: str, originais: list[Path], sha256: str,
               assinatura: str, df: pl.DataFrame | None = None) -> int:
    linhas = assinatura_colunas = de = ate = None
    if df is not None:
        linhas = df.height
        assinatura_colunas = hashlib.sha1("|".join(df.columns).encode()).hexdigest()[:12]
        de, ate = _periodo(fonte, df)
    from datetime import datetime
    modificado = datetime.fromtimestamp(max(p.stat().st_mtime for p in originais))
    descricao = str(originais[0]) if len(originais) == 1 else f"{len(originais)} arquivos: " + \
        "; ".join(p.name for p in originais)
    return con.execute(
        """insert into files (source_id, run_id, caminho, sha256, config_hash, assinatura_origem,
                              tamanho_bytes, modificado_em, linhas, assinatura_colunas, dado_de, dado_ate, status)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning id""",
        [fonte["id"], run_id, descricao, sha256, _hash_config(fonte), assinatura,
         sum(p.stat().st_size for p in originais), modificado, linhas, assinatura_colunas, de, ate, status],
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
    """Arquivo deixado na pasta de entrada (ou subpasta) que nenhuma fonte usa
    vira aviso no relatório: é assim que uma planilha nova aparece pra ser catalogada."""
    if pasta is None:
        return
    if not pasta.exists():
        execucao.registrar_erro(con, run_id, None, f"a pasta de entrada não existe: {pasta}",
                                codigo="pasta_ausente")
        return
    usados = set()
    for fonte in fontes:
        try:
            usados.update(p.resolve() for p in localizar(fonte, pasta))
        except FileNotFoundError:
            pass  # a coleta já registra arquivo ausente
    for arq in sorted(pasta.rglob("*")):
        if (not arq.is_file() or arq.name.startswith("~$")
                or arq.suffix.lower() not in EXTENSOES_DE_DADOS or arq.resolve() in usados):
            continue
        onde = arq.relative_to(pasta)
        if arq.suffix.lower() == ".pbix":
            mensagem = f"'{onde}' é um Power BI que ainda não está no catálogo de fontes."
        else:
            mensagem = f"'{onde}' está na pasta de entrada, mas ainda não está no catálogo de fontes."
        execucao.registrar_erro(con, run_id, None, mensagem, codigo="arquivo_nao_catalogado", gravidade="aviso")


# -- coleta ----------------------------------------------------------------------
def coletar(con: duckdb.DuckDBPyConnection, run_id: int, fonte: dict, origens: Origens) -> str:
    """Devolve 'novo' ou 'sem_mudanca'. Contrato quebrado ou leitura impossível levanta."""
    originais = origens.localizar(fonte)
    tabela = tabela_raw(fonte["id"])
    assinatura = _assinatura_origem(originais)
    config = _hash_config(fonte)

    ultimo = con.execute(
        "select sha256, config_hash, assinatura_origem from files "
        "where source_id = ? and status in ('novo', 'sem_mudanca') order by id desc limit 1",
        [fonte["id"]]).fetchone()
    raw_existe = tabela_existe(con, tabela)
    if ultimo and raw_existe and ultimo[1] == config and ultimo[2] == assinatura:
        _registrar(con, run_id, fonte, "sem_mudanca", originais, ultimo[0], assinatura)
        return "sem_mudanca"  # nem copia: mesmo tamanho e mesma data de gravação

    copias = [origens.obter(p) for p in originais]
    sha = copias[0].sha256 if len(copias) == 1 else \
        hashlib.sha256("|".join(c.sha256 for c in copias).encode()).hexdigest()
    if ultimo and raw_existe and ultimo[1] == config and ultimo[0] == sha:
        _registrar(con, run_id, fonte, "sem_mudanca", originais, sha, assinatura)
        return "sem_mudanca"  # salvo de novo, mas o conteúdo é o mesmo

    try:
        df, motor = ler_isolado(fonte, [c.caminho for c in copias])
    except ContratoQuebrado:
        _registrar(con, run_id, fonte, "contrato_quebrado", originais, sha, assinatura)
        raise  # o RAW anterior continua lá: melhor dado de ontem que dado errado
    except LeituraFalhou:
        _registrar(con, run_id, fonte, "erro", originais, sha, assinatura)
        raise

    file_id = _registrar(con, run_id, fonte, "novo", originais, sha, assinatura, df)
    if motor == "openpyxl":
        execucao.registrar_erro(
            con, run_id, fonte["id"], "o leitor rápido de Excel caiu com este arquivo; lido pelo "
            "alternativo (mais lento). O arquivo está legível, mas vale salvá-lo de novo no Excel.",
            codigo="leitor_alternativo", gravidade="aviso", file_id=file_id)
    df = df.with_columns(pl.lit(file_id).alias("_arquivo_id"))
    con.register("_novo", df)
    con.execute(f"create or replace table {tabela} as select * from _novo")
    con.unregister("_novo")

    pasta = RAW / fonte["id"]
    pasta.mkdir(parents=True, exist_ok=True)
    df.write_parquet(pasta / f"{sha[:16]}.parquet")
    for antigo in sorted(pasta.glob("*.parquet"), key=lambda p: p.stat().st_mtime)[:-SNAPSHOTS_POR_FONTE]:
        antigo.unlink()
    return "novo"
