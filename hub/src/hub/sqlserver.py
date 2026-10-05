"""Conexão de LEITURA direta ao SQL Server da fábrica (banco Metrics).

Duas formas de entrar, nesta ordem:
1. usuário e senha de banco guardados no Cofre de Credenciais do Windows
   (scripts/guardar_acesso_banco.py) — o acesso que o TI liberou em 10/2026;
2. a conta do Windows (Trusted_Connection), se o TI liberar também.

Usuário e senha nunca ficam em arquivo, no git ou em log: só no Cofre. O
servidor e o banco ficam em config/sqlserver.local.yaml (fora do git). O
driver é o oficial da Microsoft para Python (mssql-python), que traz o ODBC 18
embutido: não precisa instalar nada no PC. O hub só roda SELECT, e a conexão
pede ApplicationIntent=ReadOnly.
"""
from __future__ import annotations

import keyring
import keyring.errors
import mssql_python
import yaml

from hub.caminhos import RAIZ

COFRE = "gualapack-hub-banco"
_CHAVE_USUARIO = "usuario"


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


def erro_legivel(e: Exception) -> str:
    """Mensagem curta, sem nada da string de conexão (nem usuário, nem senha)."""
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
    # o resto pode trazer pedaços da conexão: corta o que vier depois de "UID"/"PWD"
    for marca in ("UID=", "PWD=", "Server="):
        if marca in texto:
            texto = texto.split(marca)[0]
    return texto.strip()[:300] or "Erro desconhecido."
