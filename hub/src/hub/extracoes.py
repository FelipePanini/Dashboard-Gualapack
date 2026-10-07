"""As outras leituras do banco da fábrica (os apontamentos ficam em banco.py).
Tudo SÓ LEITURA: cada consulta passa pela trava de sqlserver.consultar, que
recusa qualquer comando que não seja SELECT.

Dois jeitos de guardar:
- "foto": o estado atual (máquinas agora, fila de programação, WIP, carteira)
  num arquivo <nome>.parquet, regravado só quando muda. Com historico_diario,
  a primeira foto de cada dia também fica guardada em historico/ (a
  programação do PCP: é dela que um dia sai a aderência pelo banco, porque o
  banco só guarda a programação atual, não a de dias passados).
- "mensal": um arquivo por mês (<nome>_AAAA-MM.parquet), relendo os meses
  recentes a cada execução, como os apontamentos.

Só as colunas que o painel usa. Nada de nome de operador, analista, vendedor,
preço, valor nem observação livre: essas colunas nem saem do servidor.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import polars as pl

from hub.banco import arquivo_do_mes, gravar_se_mudou, meses_para_extrair, proximo_mes, texto
from hub.coleta import nomes_unicos, normalizar

log = logging.getLogger("hub")


@dataclass(frozen=True)
class Extracao:
    nome: str                       # arquivo e fonte banco.<nome>
    descricao: str
    sql: str                        # SELECT; nas mensais com dois "?" (início e fim do mês)
    mensal: bool = False
    desde: str = "2025-01"          # mensais: primeiro mês
    reextrair: int = 2              # mensais: meses recentes relidos a cada vez
    intervalo_min: int = 0          # minutos mínimos entre duas leituras (view lenta, dado que muda pouco)
    historico_diario: bool = False  # foto: guarda a primeira de cada dia em historico/
    primeiro_por: tuple[str, ...] = ()  # foto: mantém só a primeira linha de cada chave (como o Table.Distinct do Excel)


# Classificação de entrega do PCP: a mesma consulta da planilha Aderência
# Semanal (consulta "Produção (3)", lida do Power Query em 05/10/2026), sem a
# observação de negociação (texto livre): ela entra no DISTINCT, como lá, pra
# dar o mesmo número de linhas, mas não sai do servidor.
_DATA_PCP = ("CASE WHEN ISNULL(CAST(usr_DataPcp AS DATE), '') = '1899-12-30' THEN DataEmissao "
             "ELSE ISNULL(CAST(usr_DataPcp AS DATE), '') END")
_DATA_CLIENTE = "CASE WHEN CAST([Dt Cliente] AS DATE) = '1899-12-30' THEN DataEmissao ELSE CAST([Dt Cliente] AS DATE) END"
SQL_ENTREGAS = f"""
SELECT Cliente, NumPedido, NumNota, TipoProduto, Codigo, Descricao, DtPedido, DtCliente, Faturado, DataPCP,
       LeadTime, Dif, StatusDesempenho
FROM (
  SELECT DISTINCT
    Nome_Unidade AS Cliente, NumPedido, NumNota, usr_Atividade_Venda AS TipoProduto, CodItemEstoque AS Codigo,
    Descricao, CAST(DtPedido AS DATE) AS DtPedido,
    {_DATA_CLIENTE} AS DtCliente,
    DataEmissao AS Faturado,
    {_DATA_PCP} AS DataPCP,
    DATEDIFF(DAY, CAST(DtPedido AS DATE), DataEmissao) AS LeadTime,
    Dif,
    CASE WHEN DATEDIFF(DAY, DataEmissao, {_DATA_CLIENTE}) >= 0 THEN '1 - ÓTIMO'
         WHEN DATEDIFF(DAY, DataEmissao, {_DATA_PCP}) >= 0 THEN '2 - BOM'
         WHEN DATEDIFF(DAY, DataEmissao, {_DATA_PCP}) >= -5 THEN '3 - REGULAR'
         WHEN DATEDIFF(DAY, DataEmissao, {_DATA_PCP}) >= -10 THEN '4 - RUIM'
         WHEN DATEDIFF(DAY, DataEmissao, {_DATA_PCP}) < -10 THEN '5 - PÉSSIMO' END AS StatusDesempenho,
    usr_ObsNegociacao AS ObsNaoSai
  FROM dbo.View_usr_Entregas_Desempenho ved
  WHERE ved.DtPedido >= '2022-01-01' AND NumNota NOT IN ('0') AND DataEmissao >= ? AND DataEmissao < ?
) x"""

EXTRACOES: list[Extracao] = [
    Extracao("estrutura_largura", "Largura real de cada estrutura (EstrProcessos): o m² da produção, como o Machine Card.",
             "SELECT CodEstrutura, PFmtPagL FROM dbo.EstrProcessos", intervalo_min=360, primeiro_por=("cod_estrutura",)),
    Extracao("maquina_agora", "Ordens abertas em cada máquina agora (CTREntradasMaquina, status 1 = em produção).",
             """SELECT Maquina, NumOrdem, Descricao, Cliente, Processo, Atividade, DtHoraInicio, DtHoraInicioAcerto,
                       DtHoraInicioProducao, Bons, QtdPlanejado, VMProgramada, TerminoPrevisto, TerminoProgramado
                FROM dbo.CTREntradasMaquina
                WHERE Status = 1 AND NumOrdem <> '999999' AND DtHoraInicio >= DATEADD(day, -60, GETDATE())"""),
    Extracao("programacao", "Fila de programação: OPs alocadas em máquina e não finalizadas (view_usr_ProgramacaoPlanner).",
             """SELECT idwo, NumOrdem, NomeCliente, Titulo, CodAtiv, Processoo AS Processo, StatusOP, Maquina,
                       DtIniPlan, DtFimPlan, DtEntrega, QtdPlanejada, QtdProduzida, Saldo, ProducaoHora
                FROM dbo.view_usr_ProgramacaoPlanner
                WHERE Situacao = 'Alocado' AND SituacaoOP = 'Não Finalizado'"""),
    Extracao("programacao_pcp", "Programação do PCP (View_usr_programacao_teruel), uma foto por dia: base da aderência pelo banco.",
             """SELECT NumOrdem, CodRecurso, CodAtiv, Produto, QtdPlanejada, QtdProduzida, DtIniPlan, DtFimPlan,
                       Unidade, TipoProduto, DtEntrega
                FROM dbo.View_usr_programacao_teruel""", intervalo_min=60, historico_diario=True),
    Extracao("wip", "Pallets em processo disponíveis (view_usr_pallet_wip_disponiveis), sem operador nem código de barras.",
             """SELECT OP, ID, OP_HoraInicio, CodAtiv, LocalEstoque, OP_Cliente, OP_QtdPlanejado, OP_QtdProduzido_Ativ,
                       QtdMetroLinear, QtdKg, StatusWIP, StatusOP
                FROM dbo.view_usr_pallet_wip_disponiveis"""),
    Extracao("gramatura_produto", "Gramatura de cada produto pela estrutura (EstrComponentes e EstruturasOp), a mesma "
             "\"Gramatura Total\" das notas: converte em kg a carteira vendida em m².",
             """SELECT ec.CodItem,
                       (eo.usr_grMPA + eo.USR_grMPB + eo.USR_grMPC + eo.USR_grMPD + eo.usr_grMPE + eo.usr_grMPF
                        + eo.usr_grMPG + eo.usr_grMPH + eo.usr_grMPI + eo.usr_tintasgrA + eo.usr_tintasgrB
                        + eo.usr_tintasgrC + eo.usr_tintasgrD + eo.usr_tintasgrE + eo.usr_adesivogrA
                        + eo.usr_adesivogrB + eo.usr_adesivogrC + eo.usr_adesivogrD + eo.usr_adesivogrE) AS GramaturaTotal
                FROM dbo.EstrComponentes ec
                LEFT JOIN dbo.EstruturasOp eo ON eo.CodEstrutura = ec.CodEstrutura
                WHERE ec.CodItem LIKE 'PA%'""", intervalo_min=360, primeiro_por=("cod_item",)),
    Extracao("carteira", "Itens de pedido de venda, menos os cancelados (View_usr_ListaPedidosVenda), sem preço nem vendedor.",
             """SELECT NumPedido, CodCliente, Nome, Situacao, Status, [Data do Pedido], [Data Desejada (Cliente)],
                       [Data PCP], [Data Negociada], CodItemEstoque, Descricao, Unidade, Quantidade, QuantidadeFaturada,
                       TotalKG, TipoProduto, Segmento
                FROM dbo.View_usr_ListaPedidosVenda WHERE Status <> 'Cancelado'""", intervalo_min=10),
    Extracao("faturamento", "Notas de venda de produto acabado, como a tabela Faturamento do BI Dados de Produção.",
             """SELECT [Data Emissão], [Nota Fiscal], [Razão Social], SKU, Quantidade, Un, M2, [Gramatura Total],
                       [Tipo de Produto], Segmento, Pedido, NumOrdem
                FROM dbo.view_usr_notas_saida_entrada_custo
                WHERE Fatura = 'S' AND SKU LIKE 'PA%' AND [Data Emissão] >= ? AND [Data Emissão] < ?""", mensal=True),
    Extracao("entregas", "Desempenho de entrega por item faturado: a consulta e a classificação da Aderência Semanal (PCP).",
             SQL_ENTREGAS, mensal=True),
    Extracao("setup", "Setup programado x real por OP, máquina e atividade (View_usr_Acompanhamento_Prod).",
             """SELECT Recurso_Ctr, NumOrdem, Atividade, TipoProduto, DtSaidaMaquina, Min_Set_Prog, Mini_Set_Real,
                       Qtd_Produzido, QtdPLanejado, Meta_Mts_Hora, Qtd_HorP
                FROM dbo.View_usr_Acompanhamento_Prod WHERE DtSaidaMaquina >= ? AND DtSaidaMaquina < ?""",
             mensal=True, intervalo_min=30),
    Extracao("laudos", "Laudos do CQ, um por laudo com o status final (view_usr_LaudoAnalise), sem analista nem observação.",
             """SELECT NumLaudo, MIN(StatusLaudo) AS StatusLaudo, MIN(NomeCliente) AS NomeCliente, MIN(NumOP) AS NumOP,
                       MIN(DtLaudo) AS DtLaudo, COUNT(*) AS Analises
                FROM dbo.view_usr_LaudoAnalise WHERE DtLaudo >= ? AND DtLaudo < ? GROUP BY NumLaudo""",
             mensal=True, desde="2026-01"),
]


# -- conversão -------------------------------------------------------------------------
def _serie(nome: str, valores: list) -> pl.Series:
    """Tipo fixo por coluna: data vira datetime, número vira float, o resto vira texto."""
    tipos = {type(v) for v in valores if v is not None}
    if tipos and tipos <= {datetime, date}:
        return pl.Series(nome, [datetime(v.year, v.month, v.day) if type(v) is date else v for v in valores],
                         dtype=pl.Datetime("us"))
    if tipos and tipos <= {int, float, Decimal, bool}:
        return pl.Series(nome, [None if v is None else float(v) for v in valores], dtype=pl.Float64)
    return pl.Series(nome, [texto(v) for v in valores], dtype=pl.String)


def quadro(nomes: list[str], linhas: list, primeiro_por: tuple[str, ...] = ()) -> pl.DataFrame:
    colunas = nomes_unicos([normalizar(n) for n in nomes])
    df = pl.DataFrame([_serie(c, [r[i] for r in linhas]) for i, c in enumerate(colunas)])
    if primeiro_por:
        df = df.unique(subset=list(primeiro_por), keep="first", maintain_order=True)
    return df


# -- controle de quando ler de novo --------------------------------------------------
def _estado(pasta: Path) -> dict:
    arq = pasta / "_extracoes.json"
    try:
        return json.loads(arq.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _salvar_estado(pasta: Path, estado: dict) -> None:
    (pasta / "_extracoes.json").write_text(json.dumps(estado, ensure_ascii=False, indent=1), encoding="utf-8")


def _vencida(ex: Extracao, estado: dict, agora: float) -> bool:
    ultima = estado.get(ex.nome)
    return ultima is None or agora - ultima >= ex.intervalo_min * 60


# -- leitura ---------------------------------------------------------------------------
def _ler_foto(con, ex: Extracao, pasta: Path, hoje: date) -> str | None:
    from hub import sqlserver
    nomes, linhas = sqlserver.consultar(con, ex.sql)
    df = quadro(nomes, linhas, ex.primeiro_por)
    if df.height == 0:
        raise ValueError("o banco devolveu a consulta vazia; mantive a foto anterior")
    if ex.historico_diario:
        hist = pasta / "historico" / f"{ex.nome}_{hoje:%Y-%m-%d}.parquet"
        if not hist.exists():
            hist.parent.mkdir(parents=True, exist_ok=True)
            df.write_parquet(hist)
    return f"{df.height} linhas" if gravar_se_mudou(pasta / f"{ex.nome}.parquet", df) else None


def _ler_mensal(con, ex: Extracao, pasta: Path, hoje: date) -> tuple[list[str], list[str]]:
    from hub import sqlserver
    mudaram, avisos = [], []
    desde = date.fromisoformat(ex.desde + "-01")
    for m in meses_para_extrair(desde, pasta, ex.reextrair, hoje, ex.nome):
        try:
            nomes, linhas = sqlserver.consultar(con, ex.sql, (m, proximo_mes(m)))
        except Exception as e:  # noqa: BLE001 — um mês com erro não derruba os outros
            avisos.append(f"{ex.nome} {m:%m/%Y}: {sqlserver.erro_legivel(e)}")
            continue
        df = quadro(nomes, linhas)
        if df.height == 0 and m < date(hoje.year, hoje.month, 1) and arquivo_do_mes(pasta, m, ex.nome).exists():
            avisos.append(f"{ex.nome} {m:%m/%Y}: o banco devolveu o mês vazio; mantive o arquivo anterior")
            continue
        if gravar_se_mudou(arquivo_do_mes(pasta, m, ex.nome), df):
            mudaram.append(f"{m:%m/%Y} ({df.height})")
    return mudaram, avisos


def extrair(cfg: dict, hoje: date | None = None, extracoes: list[Extracao] | None = None,
            conectar=None) -> tuple[list[str], list[str]]:
    """Roda as extrações vencidas. Devolve (o que mudou, avisos)."""
    b = cfg.get("banco") or {}
    if not b.get("ativo"):
        return [], []
    pasta = Path(b["pasta"])
    pasta.mkdir(parents=True, exist_ok=True)
    hoje = hoje or date.today()
    estado = _estado(pasta)
    agora = time.time()
    pendentes = [ex for ex in (extracoes or EXTRACOES) if _vencida(ex, estado, agora)]
    if not pendentes:
        return [], []
    from hub import sqlserver
    try:
        con = (conectar or sqlserver.conectar)()
    except Exception as e:  # noqa: BLE001 — sem conexão: fica o que já foi extraído
        return [], [f"leitura do banco não rodou ({sqlserver.erro_legivel(e)}); os dados já extraídos continuam valendo"]
    mudaram, avisos = [], []
    try:
        for ex in pendentes:
            t = time.time()
            try:
                if ex.mensal:
                    m, a = _ler_mensal(con, ex, pasta, hoje)
                    mudaram += [f"{ex.nome} {x}" for x in m]
                    avisos += a
                else:
                    r = _ler_foto(con, ex, pasta, hoje)
                    if r:
                        mudaram.append(f"{ex.nome} ({r})")
                estado[ex.nome] = agora
            except Exception as e:  # noqa: BLE001 — uma extração com erro não derruba as outras
                avisos.append(f"{ex.nome}: {sqlserver.erro_legivel(e)}")
            log.info("banco: %s lido em %.1fs", ex.nome, time.time() - t)
    finally:
        con.close()
        _salvar_estado(pasta, estado)
    return mudaram, avisos
