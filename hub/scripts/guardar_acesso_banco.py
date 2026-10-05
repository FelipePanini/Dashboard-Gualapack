"""Guarda o usuário e a senha de LEITURA do banco da fábrica no Cofre de
Credenciais do Windows (keyring) e testa a conexão. Rode você mesmo, numa
janela do PowerShell, dentro da pasta hub:

    .venv\\Scripts\\python.exe scripts\\guardar_acesso_banco.py

A senha é digitada sem aparecer na tela, não vai pra arquivo nenhum, não vai
pro git e não aparece em log. Pra trocar, rode de novo; pra apagar:

    .venv\\Scripts\\python.exe scripts\\guardar_acesso_banco.py --apagar
"""
from __future__ import annotations

import argparse
import getpass
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hub import sqlserver  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apagar", action="store_true", help="remove o usuário e a senha guardados")
    args = p.parse_args()

    if args.apagar:
        sqlserver.apagar_credencial()
        print("Acesso ao banco apagado do Cofre de Credenciais.")
        return

    usuario = input("Usuário do banco (o que o TI passou): ").strip()
    if not usuario:
        sys.exit("Nenhum usuário digitado; nada foi guardado.")
    senha = getpass.getpass("Senha (não aparece na tela): ")
    if not senha:
        sys.exit("Nenhuma senha digitada; nada foi guardado.")
    sqlserver.guardar_credencial(usuario, senha)
    print("Guardado no Cofre de Credenciais do Windows. Testando a conexão (só leitura)...")

    t = time.time()
    try:
        con = sqlserver.conectar()
        cur = con.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        con.close()
    except Exception as e:  # noqa: BLE001
        print(f"Não conectou: {sqlserver.erro_legivel(e)}")
        print("O acesso continua guardado; confira com o TI e rode de novo pra trocar.")
        sys.exit(1)
    print(f"Conectou em {time.time() - t:.1f}s. Pode voltar pro Claude.")


if __name__ == "__main__":
    main()
