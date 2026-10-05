"""Conexão de LEITURA direta ao SQL Server da fábrica (banco Metrics), pela
conta do Windows. Fica pronta para quando o TI liberar a leitura (db_datareader)
para a conta: até lá o servidor recusa o login (18456) e o hub usa o Excel
como conector (hub/banco.py), com o login de banco salvo nele.

O servidor e o banco ficam em config/sqlserver.local.yaml (fora do git). O
driver é o oficial da Microsoft para Python (mssql-python), que traz o ODBC 18
embutido: não precisa instalar nada no PC. O hub só roda SELECT.
"""
from __future__ import annotations

import mssql_python
import yaml

from hub.caminhos import RAIZ


def config() -> dict:
    return yaml.safe_load((RAIZ / "config" / "sqlserver.local.yaml").read_text(encoding="utf-8"))


def conectar(timeout: int = 20):
    cfg = config()
    # confiar_certificado: o servidor usa o certificado automático do SQL Server
    # (SSL_Self_Signed_Fallback, refeito a cada reinício), sem autoridade para
    # validar. A conexão continua criptografada.
    con = mssql_python.connect(
        f"Server={cfg['servidor']};Database={cfg['banco']};Trusted_Connection=yes;Encrypt=yes;"
        f"TrustServerCertificate={'yes' if cfg.get('confiar_certificado') else 'no'};ApplicationIntent=ReadOnly;",
        timeout=timeout)
    con.timeout = 300  # segundos por consulta
    return con


def erro_legivel(e: Exception) -> str:
    """Mensagem curta, sem nada da string de conexão."""
    texto = str(e)
    if "18456" in texto:
        return "O banco recusou o login da conta do Windows (falta a liberação do TI)."
    if "certificate" in texto.lower() or "certificado" in texto.lower():
        return "O certificado do servidor não é confiável para este PC (ver confiar_certificado)."
    if "08001" in texto or "timeout" in texto.lower() or "tempo limite" in texto.lower():
        return "Não alcancei o servidor (rede da empresa ou VPN?)."
    if "229" in texto or "permission" in texto.lower() or "permissão" in texto.lower():
        return "Entrou, mas a conta não tem permissão de leitura na view."
    return texto.strip()[:300] or "Erro desconhecido."
