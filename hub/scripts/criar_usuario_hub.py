"""Cria o usuário técnico que o hub usa pra publicar no Supabase. Roda UMA vez.

1. No painel web, em Administração de acessos, gere uma chave de convite
   (perfil Visualizador, 1 uso).
2. Rode:
       uv run python scripts/criar_usuario_hub.py
   O script pede a chave, gera uma senha forte que ninguém precisa saber e
   guarda essa senha no Cofre de Credenciais do Windows (keyring).
3. Rode hub/sql/supabase/001_trusted.sql no SQL Editor do Supabase: o fim
   do arquivo autoriza este usuário a publicar.

O e-mail padrão termina em ".invalid" de propósito (domínio reservado que
não existe): ninguém consegue receber um e-mail de "esqueci a senha" dele,
então a conta só pode ser usada com a senha que está no Cofre deste PC.
"""
from __future__ import annotations

import argparse
import getpass
import secrets
import sys
from pathlib import Path

import keyring
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hub import config  # noqa: E402
from hub.publicacao import SERVICO_COFRE, config_supabase  # noqa: E402


def main() -> None:
    cfg = config.carregar()
    email_padrao = (cfg.get("publicacao") or {}).get("email", "hub-dados@painel-gualapack.invalid")
    parser = argparse.ArgumentParser(description="Cria o usuário técnico do hub no Supabase.")
    parser.add_argument("--email", default=email_padrao)
    parser.add_argument("--chave", help="chave de convite (se não passar, o script pergunta)")
    args = parser.parse_args()

    if keyring.get_password(SERVICO_COFRE, args.email):
        sys.exit(f"Já existe senha no Cofre do Windows para {args.email}. Nada a fazer.")

    chave = args.chave or getpass.getpass("Chave de convite (não aparece na tela): ").strip()
    supa = config_supabase()
    senha = secrets.token_urlsafe(32)
    resposta = requests.post(
        supa["cadastro_url"], timeout=30,
        headers={"apikey": supa["anon_key"], "Authorization": f"Bearer {supa['anon_key']}"},
        json={"email": args.email, "password": senha, "fullName": "Hub de dados (usuário técnico)",
              "inviteKey": chave})
    if resposta.status_code != 200:
        sys.exit(f"O cadastro foi recusado ({resposta.status_code}): {resposta.text[:300]}")

    keyring.set_password(SERVICO_COFRE, args.email, senha)
    print(f"Usuário técnico criado: {args.email}")
    print("Senha guardada no Cofre de Credenciais do Windows (serviço 'gualapack-hub').")
    print("Falta: rodar hub/sql/supabase/001_trusted.sql no SQL Editor do Supabase.")


if __name__ == "__main__":
    main()
