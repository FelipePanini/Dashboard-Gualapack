"""Tela local de qualidade dos dados: relatorios/qualidade.html + validacao.csv.

É a "1 tela" do MVP, antes de publicar qualquer coisa no Supabase. Abre em
qualquer navegador, sem servidor.
"""
from __future__ import annotations

import html
from datetime import date, datetime
from pathlib import Path

import duckdb

from hub.caminhos import RELATORIOS

STATUS = {  # ordem = gravidade
    "erro": ("🔴", "Erro"),
    "desatualizado": ("🟡", "Desatualizado"),
    "divergente": ("⚠️", "Divergente"),
    "aguardando": ("🔵", "Aguardando"),
    "validado": ("✅", "Validado"),
    "ok": ("✅", "OK"),
}
ORDEM = {s: i for i, s in enumerate(STATUS)}
LEITURA = {"novo": "versão nova lida", "sem_mudanca": "sem mudança desde a última",
           "contrato_quebrado": "formato mudou (mantido o anterior)", "erro": "erro na leitura"}
_PT = str.maketrans(",.", ".,")
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


SUFIXO = {"kg": " kg", "h": " h", "m_min": " m/min"}


def _num(v, unidade: str) -> str:
    if v is None:
        return "—"
    if unidade == "pct":
        return f"{v:.1f}%".translate(_PT)
    return f"{v:,.0f}".translate(_PT) + SUFIXO.get(unidade, "")


def _dif(d, pct, unidade: str) -> str:
    if d is None:
        return "—"
    if unidade == "pct":
        return f"{d:+.1f}".translate(_PT) + " p.p."
    extra = f" ({pct:+.1%})".translate(_PT) if pct is not None else ""
    return f"{d:+,.0f}".translate(_PT) + SUFIXO.get(unidade, "") + extra


MESES_NOME = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
              "Setembro", "Outubro", "Novembro", "Dezembro"]


def preencher_correcao(modelo: str | None, recorte: str, periodo: date, oficial, comparado, unidade: str) -> str | None:
    """Preenche o modelo de correção do catálogo: onde mexer e qual valor colocar."""
    if not modelo:
        return None

    def valor(x):
        if x is None:
            return "—"
        if unidade == "pct":
            return f"{x:.2f}%".translate(_PT)
        return f"{x:,.2f}".translate(_PT) + SUFIXO.get(unidade, "")

    return modelo.format(recorte=recorte, mes=MESES_NOME[periodo.month - 1],
                         valor_oficial=valor(oficial), valor_comparado=valor(comparado))


def _mes(d: date | None) -> str:
    return f"{MESES[d.month - 1]}/{d.year}" if d else "—"


def _data(d) -> str:
    if d is None:
        return "—"
    return d.strftime("%d/%m/%Y %H:%M") if isinstance(d, datetime) else d.strftime("%d/%m/%Y")


def _selo(status: str) -> str:
    icone, rotulo = STATUS.get(status, ("•", status))
    return f'<span class="selo s-{html.escape(status)}">{icone} {rotulo}</span>'


def gerar(con: duckdb.DuckDBPyConnection, run_id: int | None = None) -> Path:
    if run_id is None:
        run_id = con.execute("select max(id) from processing_runs").fetchone()[0]
    execucao = con.execute("select id, started_at, finished_at, status from processing_runs where id = ?",
                           [run_id]).fetchone()
    fontes = con.execute(
        "select fonte, tipo, ultima_leitura, lido_em, arquivo_salvo_em, dado_ate, linhas, status "
        "from v_saude_fonte order by fonte").fetchall()
    validacoes = con.execute(
        """select v.indicador, i.nome, i.unidade, v.recorte, v.periodo, v.fonte_oficial, v.valor_oficial,
                  v.fonte_comparada, v.valor_comparado, v.dif_abs, v.dif_pct, v.status, v.motivo,
                  i.definicao, i.status_definicao, i.correcao
           from validation_results v
           join indicators i on i.codigo = v.indicador
                            and i.versao = (select max(versao) from indicators where codigo = v.indicador)
           where v.run_id = ?
           order by v.indicador, v.recorte, v.periodo""", [run_id]).fetchall()
    problemas = con.execute(
        "select gravidade, coalesce(source_id, '—'), codigo, mensagem from errors where run_id = ? "
        "order by gravidade, source_id", [run_id]).fetchall()

    contagem: dict[str, int] = {}
    for v in validacoes:
        contagem[v[11]] = contagem.get(v[11], 0) + 1
    correcoes = []  # (indicador, recorte, periodo, instrução) — o caminho pra zerar os divergentes
    for v in validacoes:
        if v[11] == "divergente":
            instrucao = preencher_correcao(v[15], v[3], v[4], v[6], v[8], v[2])
            if instrucao:
                correcoes.append((v[1], v[3], v[4], instrucao))
    fontes_ok = sum(1 for f in fontes if f[7] == "ok")

    # --- HTML -----------------------------------------------------------------
    cartoes = "".join(
        f'<div class="cartao s-{s}"><div class="n">{contagem.get(s, 0)}</div>{_selo(s)}</div>'
        for s in ["validado", "divergente", "erro", "desatualizado", "aguardando"])

    linhas_fontes = "".join(
        f"<tr><td><code>{html.escape(f[0])}</code></td><td>{_selo(f[7])}</td>"
        f"<td>{html.escape(LEITURA.get(f[2], f[2] or '—'))}</td><td>{_data(f[4])}</td><td>{_data(f[5])}</td>"
        f"<td class='num'>{'—' if f[6] is None else f'{f[6]:,}'.translate(_PT)}</td></tr>"
        for f in fontes)

    blocos = []
    por_indicador: dict[str, list] = {}
    for v in validacoes:
        por_indicador.setdefault(v[0], []).append(v)
    for codigo, linhas in por_indicador.items():
        nome, unidade, definicao, status_def = linhas[0][1], linhas[0][2], linhas[0][13], linhas[0][14]
        pior = min((l[11] for l in linhas), key=lambda s: ORDEM.get(s, 99))
        resumo = ", ".join(f"{n} {STATUS[s][1].lower()}" for s in STATUS
                           if (n := sum(1 for l in linhas if l[11] == s)))
        def _motivo(l):
            texto = html.escape(l[12] or "")
            instrucao = preencher_correcao(l[15], l[3], l[4], l[6], l[8], l[2]) if l[11] == "divergente" else None
            return texto + (f"<div class='corrigir'>Corrigir: {html.escape(instrucao)}</div>" if instrucao else "")

        corpo = "".join(
            f"<tr class='r-{l[11]}'><td>{html.escape(l[3])}</td><td>{_mes(l[4])}</td>"
            f"<td class='num'>{_num(l[6], unidade)}</td><td class='num'>{_num(l[8], unidade)}</td>"
            f"<td class='num'>{_dif(l[9], l[10], unidade)}</td><td>{_selo(l[11])}</td>"
            f"<td class='motivo'>{_motivo(l)}</td></tr>"
            for l in linhas)
        fonte_of = html.escape(linhas[0][5] or "—")
        fonte_cmp = html.escape(next((l[7] for l in linhas if l[7]), "—"))
        blocos.append(
            f"<details {'open' if pior not in ('validado', 'aguardando') else ''}>"
            f"<summary>{_selo(pior)} <b>{html.escape(nome)}</b> <code>{html.escape(codigo)}</code>"
            f" <span class='mut'>· {resumo} · definição {html.escape(status_def or '—')}</span></summary>"
            f"<p class='def'>{html.escape(definicao)}</p>"
            f"<table><thead><tr><th>Recorte</th><th>Mês</th><th class='num'>Oficial<br><code>{fonte_of}</code></th>"
            f"<th class='num'>Comparado<br><code>{fonte_cmp}</code></th><th class='num'>Diferença</th>"
            f"<th>Status</th><th>Motivo</th></tr></thead><tbody>{corpo}</tbody></table></details>")

    linhas_problemas = "".join(
        f"<tr><td>{_selo('erro' if p[0] == 'erro' else 'divergente').replace('Divergente', 'Aviso')}</td>"
        f"<td><code>{html.escape(p[1])}</code></td><td><code>{html.escape(p[2])}</code></td>"
        f"<td>{html.escape(p[3])}</td></tr>" for p in problemas) or "<tr><td colspan=4>Nenhum.</td></tr>"

    # O caminho pra zerar os divergentes: divergência cuja causa conhecida é
    # uma célula de planilha desatualizada ou errada vira instrução direta.
    if correcoes:
        itens = "".join(
            f"<tr><td>{html.escape(c[0])}</td><td>{html.escape(c[1])}</td><td>{_mes(c[2])}</td>"
            f"<td>{html.escape(c[3])}</td></tr>" for c in correcoes)
        secao_correcoes = (
            f"<h2>O que corrigir nas planilhas ({len(correcoes)})</h2>"
            "<p class='mut'>Divergências cuja causa é uma célula de planilha desatualizada ou errada. "
            "Corrigida a célula, a próxima execução valida sozinha.</p>"
            "<div class='wrap'><table><thead><tr><th>Indicador</th><th>Recorte</th><th>Mês</th>"
            f"<th>Onde e o quê</th></tr></thead><tbody>{itens}</tbody></table></div>")
    else:
        secao_correcoes = ""

    pagina = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qualidade dos dados</title>
<style>
:root{{--bg:#f6f7f9;--card:#fff;--txt:#17202a;--mut:#5d6b78;--linha:#e3e7ec;
 --ok:#1f7a3a;--div:#a15c00;--err:#b42318;--des:#8a6d00;--agu:#1d5fa8;}}
@media (prefers-color-scheme:dark){{:root{{--bg:#12161b;--card:#1b2128;--txt:#e6ebf0;--mut:#9aa6b2;--linha:#2a323b;
 --ok:#5cc97e;--div:#f0a33c;--err:#ff6b5f;--des:#e5c547;--agu:#6aa8ff;}}}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 system-ui,Segoe UI,sans-serif}}
main{{max-width:1180px;margin:0 auto;padding:24px 16px 48px}} h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:16px;margin:28px 0 10px}}
.mut{{color:var(--mut);font-weight:400}} code{{font:12px ui-monospace,Consolas,monospace;color:var(--mut)}}
.cartoes{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px}}
.cartao{{background:var(--card);border:1px solid var(--linha);border-radius:10px;padding:14px}} .cartao .n{{font-size:28px;font-weight:700}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--linha);border-radius:10px;overflow:hidden}}
th,td{{padding:7px 10px;border-bottom:1px solid var(--linha);text-align:left;vertical-align:top}} th{{font-size:12px;color:var(--mut);font-weight:600}}
td.num,th.num{{text-align:right;font-variant-numeric:tabular-nums}} td.motivo{{color:var(--mut)}}
.selo{{white-space:nowrap;font-weight:600;font-size:12.5px}} .s-validado,.s-ok{{color:var(--ok)}} .s-divergente{{color:var(--div)}}
.s-erro{{color:var(--err)}} .s-desatualizado{{color:var(--des)}} .s-aguardando{{color:var(--agu)}}
details{{background:var(--card);border:1px solid var(--linha);border-radius:10px;margin:10px 0;padding:10px 12px}}
details table{{margin-top:8px;border:none}} summary{{cursor:pointer}} .def{{margin:8px 0 0;color:var(--mut)}}
.wrap{{overflow-x:auto}} .corrigir{{margin-top:4px;color:var(--div);font-weight:600}}
</style></head><body><main>
<h1>Qualidade dos dados</h1>
<div class="mut">Execução {execucao[0]} · {_data(execucao[1])} → {_data(execucao[2])} · {_selo(execucao[3])} ·
{fontes_ok} de {len(fontes)} fontes OK</div>
<div class="cartoes">{cartoes}</div>
<h2>Fontes</h2>
<div class="wrap"><table><thead><tr><th>Fonte</th><th>Status</th><th>Última leitura</th><th>Arquivo salvo em</th>
<th>Dado até</th><th class="num">Linhas</th></tr></thead><tbody>{linhas_fontes}</tbody></table></div>
{secao_correcoes}
<h2>Indicadores</h2>
{''.join(blocos) or '<p class="mut">Nenhuma validação nesta execução.</p>'}
<h2>Erros e avisos da execução</h2>
<div class="wrap"><table><thead><tr><th>Tipo</th><th>Fonte</th><th>Código</th><th>Mensagem</th></tr></thead>
<tbody>{linhas_problemas}</tbody></table></div>
</main></body></html>"""

    RELATORIOS.mkdir(parents=True, exist_ok=True)
    destino = RELATORIOS / "qualidade.html"
    destino.write_text(pagina, encoding="utf-8")
    # CSV pro Excel em português: BOM (senão os acentos quebram), ";" e vírgula decimal.
    con.execute("select * from validation_results where run_id = ? order by indicador, recorte, periodo",
                [run_id]).pl().write_csv(RELATORIOS / "validacao.csv", separator=";",
                                         include_bom=True, decimal_comma=True)
    import polars as pl
    pl.DataFrame([(c[0], c[1], c[2], c[3]) for c in correcoes],
                 schema={"indicador": pl.String, "recorte": pl.String, "mes": pl.Date, "onde_e_o_que": pl.String},
                 orient="row").write_csv(RELATORIOS / "correcoes.csv", separator=";", include_bom=True)
    return destino
