"""Conexão de LEITURA direta ao SQL Server da fábrica (banco Metrics).

O hub NUNCA altera o banco. Três travas, uma em cima da outra:
1. o usuário que o TI liberou é de leitura;
2. a conexão pede ApplicationIntent=ReadOnly;
3. toda consulta passa por so_leitura(): só entra um único SELECT (ou WITH
   ... SELECT); INSERT, UPDATE, DELETE, MERGE, EXEC, CREATE, ALTER, DROP,
   TRUNCATE, SELECT ... INTO, USE e afins são recusados antes de chegar ao
   servidor.

Duas formas de entrar, nesta ordem:
1. usuário e senha de banco guardados no Cofre de Credenciais do Windows
   (scripts/guardar_acesso_banco.py) — o acesso que o TI liberou em 10/2026;
2. a conta do Windows (Trusted_Connection), se o TI liberar também.

Usuário e senha nunca ficam em arquivo, no git ou em log: só no Cofre. O
servidor e o banco ficam em config/sqlserver.local.yaml (fora do git). O
driver é o oficial da Microsoft para Python (mssql-python), que traz o ODBC 18
embutido: não precisa instalar nada no PC.
"""
from __future__ import annotations

import re
import time

import keyring
import keyring.errors
import mssql_python
import yaml

from hub.caminhos import RAIZ

COFRE = "gualapack-hub-banco"
_CHAVE_USUARIO = "usuario"


class ComandoRecusado(ValueError):
    """Consulta que não é só leitura: o hub não manda pro banco."""


def config() -> dict:
    return yaml.safe_load((RAIZ / "config" / "sqlserver.local.yaml").read_text(encoding="utf-8"))


def credencial() -> tuple[str, str] | None:
    """(usuário, senha) do Cofre, ou None se não houver."""
    usuario = keyring.get_password(COFRE, _CHAVE_USUARIO)
    if not usuario:
        return None
    senha = keyring.get_password(COFRE, usuario)
    return (usuario, senha) if senha else None


def guardar_credencial(usuario: str, senha: str) -> None:
    antigo = keyring.get_password(COFRE, _CHAVE_USUARIO)
    if antigo and antigo != usuario:
        try:
            keyring.delete_password(COFRE, antigo)
        except keyring.errors.PasswordDeleteError:
            pass
    keyring.set_password(COFRE, _CHAVE_USUARIO, usuario)
    keyring.set_password(COFRE, usuario, senha)


def apagar_credencial() -> None:
    usuario = keyring.get_password(COFRE, _CHAVE_USUARIO)
    for nome in ([usuario] if usuario else []) + [_CHAVE_USUARIO]:
        try:
            keyring.delete_password(COFRE, nome)
        except keyring.errors.PasswordDeleteError:
            pass


def _valor_odbc(v: str) -> str:
    # valor entre chaves: aceita ; = e espaços na senha; "}" vira "}}"
    return "{" + v.replace("}", "}}") + "}"


def conectar(timeout: int = 20):
    cfg = config()
    cred = credencial()
    login = (f"UID={_valor_odbc(cred[0])};PWD={_valor_odbc(cred[1])};" if cred
             else "Trusted_Connection=yes;")
    # confiar_certificado: o servidor usa o certificado automático do SQL Server
    # (SSL_Self_Signed_Fallback, refeito a cada reinício), sem autoridade para
    # validar. A conexão continua criptografada.
    con = mssql_python.connect(
        f"Server={cfg['servidor']};Database={cfg['banco']};{login}Encrypt=yes;"
        f"TrustServerCertificate={'yes' if cfg.get('confiar_certificado') else 'no'};ApplicationIntent=ReadOnly;",
        timeout=timeout)
    con.timeout = 300  # segundos por consulta
    return con


def aguardar(tentativas: int = 7, intervalo: float = 15, conectar_fn=None, dormir=time.sleep,
             relogio=time.monotonic) -> float | None:
    """Espera o banco responder. Logo depois que o agendador acorda o PC, a rede
    leva alguns segundos para voltar e a leitura falharia à toa. Devolve os
    segundos esperados (0 se respondeu de primeira), ou None se não respondeu
    em nenhuma tentativa (o hub segue com o que já foi extraído)."""
    conectar_fn = conectar_fn or (lambda: conectar(timeout=10))
    inicio = relogio()
    for i in range(tentativas):
        try:
            conectar_fn().close()
            return relogio() - inicio
        except Exception:  # noqa: BLE001 — sem rede ainda: tenta de novo
            if i < tentativas - 1:
                dormir(intervalo)
    return None


# -- só leitura -----------------------------------------------------------------------
_PROIBIDAS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|EXEC|EXECUTE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DENY|INTO|"
    r"USE|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL|RECONFIGURE|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|WRITETEXT|"
    r"UPDATETEXT|SET|DECLARE|BEGIN|COMMIT|ROLLBACK|SAVE|WAITFOR|SP_\w+|XP_\w+)\b", re.IGNORECASE)


def so_leitura(sql: str) -> str:
    """Devolve o próprio SQL se for uma única consulta de leitura; senão,
    ComandoRecusado. Comentários e textos entre aspas não contam (um nome de
    coluna como [Data de Entrega] ou um literal 'DELETE' não disparam a trava)."""
    sem_comentario = re.sub(r"--[^\n]*|/\*.*?\*/", " ", sql, flags=re.S)
    sem_texto = re.sub(r"'(?:[^']|'')*'", "''", sem_comentario)
    sem_nomes = re.sub(r"\[[^\]]*\]", "[]", sem_texto)
    corpo = sem_nomes.strip().rstrip(";").strip()
    if not re.match(r"(SELECT|WITH)\b", corpo, re.IGNORECASE):
        raise ComandoRecusado("só consultas (SELECT) vão pro banco da fábrica")
    if ";" in corpo:
        raise ComandoRecusado("uma consulta por vez: mais de um comando no mesmo texto")
    proibida = _PROIBIDAS.search(corpo)
    if proibida:
        raise ComandoRecusado(f"comando que altera ou administra o banco: {proibida.group(0).upper()}")
    return sql


def consultar(con, sql: str, params: tuple | list = (), tentativas: int = 2) -> tuple[list[str], list]:
    """Roda uma consulta de leitura e devolve (nomes das colunas, linhas).
    O driver às vezes devolve um erro genérico passageiro (05/10: um mês dos
    apontamentos, que na segunda vez veio em 1 s): tenta de novo uma vez."""
    sql = so_leitura(sql)
    for tentativa in range(1, tentativas + 1):
        cur = con.cursor()
        try:
            if params:
                cur.execute(sql, tuple(params))
            else:
                cur.execute(sql)
            return [d[0] for d in cur.description], cur.fetchall()
        except Exception:
            if tentativa == tentativas:
                raise
            time.sleep(2)
        finally:
            cur.close()
    raise RuntimeError("inalcançável")


def erro_legivel(e: Exception) -> str:
    """Mensagem curta, sem nada da string de conexão (nem usuário, nem senha)."""
    if isinstance(e, ComandoRecusado):
        return f"consulta recusada pela trava de leitura: {e}"
    texto = str(e)
    if "18456" in texto or "login failed" in texto.lower():
        return ("O banco recusou o usuário e a senha guardados (confira com o TI)." if credencial()
                else "O banco recusou o login da conta do Windows (falta a liberação do TI).")
    if "certificate" in texto.lower() or "certificado" in texto.lower():
        return "O certificado do servidor não é confiável para este PC (ver confiar_certificado)."
    if "08001" in texto or "timeout" in texto.lower() or "tempo limite" in texto.lower():
        return "Não alcancei o servidor (rede da empresa ou VPN?)."
    if "229" in texto or "permission" in texto.lower() or "permissão" in texto.lower():
        return "Entrou, mas a conta não tem permissão de leitura nesse objeto."
    if "invalid object name" in texto.lower():
        return "A consulta pede uma tabela ou view que o acesso de leitura não enxerga."
    # o resto pode trazer pedaços da conexão: corta o que vier depois de "UID"/"PWD"
    for marca in ("UID=", "PWD=", "Server="):
        if marca in texto:
            texto = texto.split(marca)[0]
    return texto.strip()[:300] or "Erro desconhecido."
