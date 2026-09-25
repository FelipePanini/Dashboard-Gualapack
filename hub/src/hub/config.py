"""Configuração: fontes (local, fora do git), indicadores e recortes (versionados)."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import yaml

from hub.caminhos import CONFIG


class ConfigInvalida(Exception):
    pass


def _ler(nome: str) -> dict:
    caminho = CONFIG / nome
    if not caminho.exists():
        raise ConfigInvalida(f"Falta config/{nome}. Copie o arquivo .exemplo e preencha.")
    with caminho.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def carregar(nome_fontes: str = "fontes.local.yaml") -> dict:
    fontes = _ler(nome_fontes)
    ano = int(fontes.get("ano") or date.today().year)
    pastas = fontes.get("pastas") or {}
    substituicoes = {"ano": ano, **pastas}
    for fonte in fontes["fontes"]:
        fonte["arquivo"] = fonte["arquivo"].format(**substituicoes)
    return {
        "ano": ano,
        # Pasta onde as planilhas são deixadas: é ela que o hub vigia e inventaria.
        "pasta_entrada": Path(pastas["entrada"]) if pastas.get("entrada") else None,
        # Pasta compartilhada com os originais e a lista do que copiar dela
        # pra pasta de entrada antes de cada execução (hub/espelho.py).
        "pasta_originais": Path(pastas["originais"]) if pastas.get("originais") else None,
        "espelho": fontes.get("espelho") or [],
        "fontes": fontes["fontes"],
        "indicadores": _ler("indicadores.yaml")["indicadores"],
        "recortes": _ler("recortes.yaml")["recortes"],
        "publicacao": fontes.get("publicacao") or {},
    }
