"""Publica a planta baixa do chão de fábrica para a maquete 3D da aba WIP.

A imagem (hub/data/planta/fabrica.png, gerada por scripts/gerar_planta.py) vai
para o Supabase, atrás do login, e não para o site: o repositório é público.
Usa o mesmo usuário técnico da publicação do hub. Precisa do
hub/sql/supabase/008_wip_maquete.sql aplicado.

    uv run python scripts/publicar_planta.py

Rodar de novo só quando a planta mudar (o script avisa se já é a mesma).
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import requests

from hub import config, publicacao

PASTA = Path(__file__).resolve().parents[1] / "data" / "planta"


def main() -> None:
    png, info = PASTA / "fabrica.png", PASTA / "fabrica.json"
    if not png.exists() or not info.exists():
        sys.exit(f"Falta a planta em {PASTA}: rode antes scripts/gerar_planta.py")
    dados = png.read_bytes()
    meta = json.loads(info.read_text(encoding="utf-8"))
    if dados[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit(f"{png} não é um PNG")
    largura, altura = int.from_bytes(dados[16:20], "big"), int.from_bytes(dados[20:24], "big")   # cabeçalho IHDR
    planta = {
        "imagem": base64.b64encode(dados).decode("ascii"),
        "largura_px": largura, "altura_px": altura,
        "metros_por_px": meta["metros_por_px"],
        "recorte_px": meta["recorte_px"], "contorno_px": meta["contorno_px"],
        "assinatura": hashlib.md5(dados).hexdigest(),
    }

    cfg = config.carregar()
    email = (cfg.get("publicacao") or {}).get("email")
    senha = publicacao.senha_do_cofre(email) if email else None
    if not senha:
        sys.exit("Sem usuário técnico no Cofre do Windows (rode scripts/criar_usuario_hub.py)")
    supa = publicacao.config_supabase()
    sessao = requests.Session()
    login = sessao.post(f"{supa['url']}/auth/v1/token?grant_type=password", timeout=30,
                        headers={"apikey": supa["anon_key"]}, json={"email": email, "password": senha})
    if login.status_code != 200:
        sys.exit(f"O login do usuário técnico foi recusado ({login.status_code})")
    cab = {"apikey": supa["anon_key"], "Authorization": f"Bearer {login.json()['access_token']}",
           "Content-Type": "application/json"}

    atual = sessao.get(f"{supa['url']}/rest/v1/v_hub_planta?select=assinatura", headers=cab, timeout=60)
    if atual.status_code == 200 and atual.json() and atual.json()[0].get("assinatura") == planta["assinatura"]:
        print("A planta publicada já é esta. Nada a fazer.")
        return
    resposta = sessao.post(f"{supa['url']}/rest/v1/rpc/hub_publicar", headers=cab, timeout=180,
                           data=json.dumps({"dados": {"planta": planta}}).encode("utf-8"))
    if resposta.status_code >= 300:
        sys.exit(f"O Supabase recusou a planta ({resposta.status_code}): {resposta.text[:300]}")
    if (resposta.json() or {}).get("planta") != 1:
        sys.exit("O Supabase ainda não conhece a planta: rode hub/sql/supabase/008_wip_maquete.sql no SQL Editor")
    print(f"Planta publicada: {len(dados) / 1024:.0f} KB, {largura}x{altura} px, {meta['metros_por_px']} m/px")


if __name__ == "__main__":
    main()
