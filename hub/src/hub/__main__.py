"""Uma execução completa do hub.

    uv run hub                     coleta, valida e gera o relatório
    uv run hub --se-mudou          só roda se algo mudou na pasta de entrada
                                   ou na configuração (é o que o agendador usa)
    uv run hub relatorio           só regenera o relatório da última execução
    uv run hub publicar            reenvia pro Supabase tudo da última execução
                                   (primeira vez, ou se o dado de lá se perdeu)
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date

from hub import coleta, config, db, espelho, execucao, medicao, publicacao, relatorio, transformacao, validacao
from hub.caminhos import CONFIG, DADOS, LOGS, SQL
from hub.origens import Origens, localizar

log = logging.getLogger("hub")
MARCA_ULTIMA_EXECUCAO = DADOS / "ultima_execucao"
MAXIMO_SEM_RODAR_S = 24 * 3600  # mesmo sem mudança, roda 1x/dia: o frescor depende da data de hoje


def _configurar_log() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [
        logging.FileHandler(LOGS / f"hub-{date.today():%Y-%m}.log", encoding="utf-8")]
    if sys.stderr is not None:  # rodando por pythonw.exe (agendador) não há console
        handlers.append(logging.StreamHandler())
    logging.basicConfig(level=logging.INFO, handlers=handlers,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")


def _momento(caminho) -> float:
    st = caminho.stat()
    # st_ctime no Windows é a data de criação: arquivo copiado pro lugar mantém
    # o "modificado em" antigo, mas ganha data de criação nova.
    return max(st.st_mtime, st.st_ctime)


def algo_mudou(cfg: dict) -> str | None:
    """Motivo pra rodar, ou None se nada mudou desde a última execução."""
    if not MARCA_ULTIMA_EXECUCAO.exists():
        return "primeira execução"
    ultima = float(MARCA_ULTIMA_EXECUCAO.read_text())
    if time.time() - ultima > MAXIMO_SEM_RODAR_S:
        return "mais de 24 h sem rodar"
    for pasta in (CONFIG, SQL):
        for arq in pasta.rglob("*"):
            if arq.is_file() and _momento(arq) > ultima:
                return f"configuração alterada ({arq.name})"
    entrada = cfg["pasta_entrada"]
    arquivos = list(entrada.rglob("*")) if entrada and entrada.exists() else []
    for fonte in cfg["fontes"]:  # fontes com caminho absoluto fora da pasta de entrada
        try:
            arquivos.extend(localizar(fonte, entrada))
        except FileNotFoundError:
            pass
    for arq in arquivos:
        if arq.is_file() and not arq.name.startswith("~$") and _momento(arq) > ultima:
            return f"arquivo novo ou alterado ({arq.name})"
    return None


def executar(gatilho: str = "manual", so_se_mudou: bool = False) -> int:
    cfg = config.carregar()
    # Primeiro traz da pasta compartilhada o que mudou: a cópia nova faz o
    # "algo mudou" abaixo disparar a execução.
    copiados, avisos_espelho = espelho.espelhar(cfg)
    if copiados:
        log.info("copiado da pasta compartilhada: %s", ", ".join(copiados))
    for aviso in avisos_espelho:
        log.warning("espelho: %s", aviso)
    if so_se_mudou:
        motivo = algo_mudou(cfg)
        if motivo is None:
            log.info("nada mudou desde a última execução")
            return 0
        log.info("rodando: %s", motivo)

    inicio = time.time()
    con = db.conectar()
    run = execucao.iniciar(con, gatilho)
    log.info("execução %s iniciada (%s)", run, gatilho)
    for aviso in avisos_espelho:  # entram no relatório e na página Qualidade dos dados
        execucao.registrar_erro(con, run, None, aviso, codigo="espelho", gravidade="aviso")

    coleta.sincronizar_fontes(con, cfg["fontes"])
    coleta.inventariar_pasta(con, run, cfg["pasta_entrada"], cfg["fontes"])
    with Origens(cfg["pasta_entrada"]) as origens:
        for fonte in cfg["fontes"]:
            try:
                status = coleta.coletar(con, run, fonte, origens)
                log.info("  %-36s %s", fonte["id"], status)
            except coleta.ContratoQuebrado as e:
                execucao.registrar_excecao(con, run, fonte["id"], e, codigo="contrato_quebrado")
                log.error("  %-36s CONTRATO QUEBRADO: %s", fonte["id"], e)
            except FileNotFoundError as e:
                execucao.registrar_excecao(con, run, fonte["id"], e, codigo="arquivo_ausente")
                log.error("  %-36s ARQUIVO AUSENTE: %s", fonte["id"], e)
            except coleta.LeituraFalhou as e:
                execucao.registrar_excecao(con, run, fonte["id"], e, codigo="leitura_falhou")
                log.error("  %-36s LEITURA FALHOU: %s", fonte["id"], e)
            except Exception as e:  # uma fonte quebrada não derruba as outras
                execucao.registrar_excecao(con, run, fonte["id"], e)
                log.exception("  %-36s ERRO", fonte["id"])

    transformacao.preparar_parametros(con, cfg)
    transformacao.executar_clean(con, run)
    transformacao.executar_checagens(con, run)
    medicao.registrar_indicadores(con, cfg["indicadores"])
    medicao.calcular(con, run, cfg["indicadores"])
    contagem = validacao.validar(con, run)
    status = execucao.finalizar(con, run)
    try:
        log.info("publicação: %s", publicacao.publicar(con, run, cfg))
    except Exception as e:  # falha de rede/Supabase não invalida o dado: vira aviso no relatório
        execucao.registrar_erro(con, run, None, f"publicação no Supabase falhou: {e}",
                                codigo="publicacao_falhou", gravidade="aviso")
        log.error("publicação falhou: %s", e)
    caminho = relatorio.gerar(con, run)
    con.close()
    MARCA_ULTIMA_EXECUCAO.write_text(str(inicio))

    log.info("validação: %s", ", ".join(f"{k}={v}" for k, v in sorted(contagem.items())) or "nada")
    log.info("execução %s terminou: %s · relatório em %s", run, status, caminho)
    return 0 if status == "ok" else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="hub", description="Data hub de produção — Gualapack Jaguariúna")
    parser.add_argument("comando", nargs="?", default="executar", choices=["executar", "relatorio", "publicar"])
    parser.add_argument("--gatilho", default="manual", help="manual | agendado | teste")
    parser.add_argument("--se-mudou", action="store_true",
                        help="só roda se algo mudou na pasta de entrada ou na configuração")
    args = parser.parse_args()
    _configurar_log()
    try:
        if args.comando == "relatorio":
            con = db.conectar()
            log.info("relatório: %s", relatorio.gerar(con))
            con.close()
            return
        if args.comando == "publicar":
            con = db.conectar()
            run = con.execute("select max(id) from processing_runs where finished_at is not null").fetchone()[0]
            if run is None:
                sys.exit("nenhuma execução terminada ainda: rode 'uv run hub' primeiro")
            log.info("publicação da execução %s: %s", run,
                     publicacao.publicar(con, run, config.carregar(), republicar=True))
            con.close()
            return
        sys.exit(executar(args.gatilho, args.se_mudou))
    except Exception:
        log.exception("falha na execução")  # no agendador não há console: o log é o único registro
        sys.exit(2)


if __name__ == "__main__":
    main()
