"""Espelho: traz pra pasta de entrada a versão nova de cada planilha original.

As planilhas são mantidas na pasta compartilhada (onde os vínculos entre
elas funcionam). A pasta de entrada guarda uma cópia de cada uma, e é dela
que o hub lê. Antes de cada execução, cada original do catálogo "espelho"
(config/fontes.local.yaml) que estiver mais novo que a cópia é copiado por
cima dela. O original nunca é alterado.

- Cópia mais nova que o original (alguém editou a cópia): não sobrescreve,
  vira aviso. A mudança precisa ir pro original.
- Original com curinga (série, ex.: o arquivo do mês): atualiza os que já
  estão na pasta de entrada e traz o próximo da série quando ele aparece.
  Com "so_o_ultimo: true" (revisões, ex.: Rev2 -> Rev3) fica só o último;
  o anterior sai da pasta de entrada pra hub/data/espelho_substituidos.
- A cópia é gravada com nome temporário "~$hub-..." e depois trocada de uma
  vez: o hub e o Excel nunca veem arquivo pela metade. Se a cópia estiver
  aberta no Excel, fica pra próxima execução.
- Nada é apagado: a cópia substituída fica em hub/data/espelho_substituidos
  (a última de cada nome), caso alguém tenha editado as duas.
"""
from __future__ import annotations

import fnmatch
import os
import shutil
from datetime import datetime
from pathlib import Path

from hub.caminhos import DADOS

FOLGA_S = 2  # FAT/OneDrive arredondam o horário de modificação


def _quando(segundos: float) -> str:
    return datetime.fromtimestamp(segundos).strftime("%d/%m %H:%M")


def _originais(item: str, base: Path | None, ano: int, copias: dict[str, Path],
               so_o_ultimo: bool = False) -> tuple[list[Path], str]:
    """Os originais a espelhar. Com curinga (série, ex.: um arquivo por mês):
    todos os que já têm cópia na pasta de entrada (edição de mês anterior
    também chega) e, dos outros, só o último pela ordem do nome, se vier
    depois de tudo que já está lá: "10. ..." depois de "09. ...", "Rev3"
    depois de "Rev2". Arquivo antigo editado não entra só por ser recente.
    so_o_ultimo: só o último pela ordem do nome (revisões: Rev2 -> Rev3)."""
    padrao = Path(item.format(ano=ano))
    if not padrao.is_absolute():
        if base is None:
            return [], f"'{item}' é relativo, mas falta pastas.originais no fontes.local.yaml"
        padrao = base / padrao
    if not any(c in padrao.name for c in "*?["):
        return ([padrao], "") if padrao.is_file() else ([], f"original não encontrado: '{item}'")
    candidatos = [p for p in padrao.parent.glob(padrao.name) if p.is_file() and not p.name.startswith("~$")]
    if not candidatos:
        return [], f"nenhum original com o padrão '{padrao.name}' em '{padrao.parent.name}'"
    if so_o_ultimo:
        return [max(candidatos, key=lambda p: p.name.lower())], ""
    ja_tem = [p for p in candidatos if p.name.lower() in copias]
    sem_copia = [p for p in candidatos if p.name.lower() not in copias]
    escolhidos = list(ja_tem)
    if sem_copia:
        novo = max(sem_copia, key=lambda p: p.name.lower())
        if novo.name.lower() > max((p.name.lower() for p in ja_tem), default=""):
            escolhidos.append(novo)
    return escolhidos, ""


def _destino(original: Path, padrao: str, entrada: Path, copias: dict[str, Path]) -> Path:
    """A cópia com o mesmo nome, em qualquer subpasta; se ainda não existe
    (arquivo novo do mês), vai pra pasta de uma cópia do mesmo padrão."""
    if original.name.lower() in copias:
        return copias[original.name.lower()]
    vizinha = next((p for nome, p in copias.items() if fnmatch.fnmatch(nome, padrao.lower())), None)
    return (vizinha.parent if vizinha else entrada) / original.name


def espelhar(cfg: dict, guarda: Path | None = None) -> tuple[list[str], list[str]]:
    """Devolve (arquivos copiados, avisos). Revisão substituída (so_o_ultimo)
    sai da pasta de entrada pra "guarda" (hub/data), nunca é apagada."""
    itens = cfg.get("espelho") or []
    entrada = cfg.get("pasta_entrada")
    if not itens or entrada is None:
        return [], []
    if not entrada.exists():
        return [], [f"a pasta de entrada não existe: {entrada}"]
    copias = {p.name.lower(): p for p in entrada.rglob("*") if p.is_file() and not p.name.startswith("~$")}
    guarda = guarda or DADOS / "espelho_substituidos"
    copiados, avisos = [], []
    for item in itens:
        texto, so_o_ultimo = (item, False) if isinstance(item, str) else (item["original"], bool(item.get("so_o_ultimo")))
        padrao = Path(texto.format(ano=cfg["ano"])).name
        originais, problema = _originais(texto, cfg.get("pasta_originais"), cfg["ano"], copias, so_o_ultimo)
        if problema:
            avisos.append(problema)
        for original in originais:
            destino = _destino(original, padrao, entrada, copias)
            aviso = _copiar(original, destino, entrada, guarda)
            if aviso:
                avisos.append(aviso)
                continue
            copias[destino.name.lower()] = destino
            if aviso is not None:  # "" = copiou; None = já estava igual
                copiados.append(destino.name)
            if so_o_ultimo:
                avisos += _guardar_antigas(original, padrao, copias, guarda)
    return copiados, avisos


def _guardar_antigas(atual: Path, padrao: str, copias: dict[str, Path], guarda: Path) -> list[str]:
    """Tira da pasta de entrada as cópias de revisões anteriores da série."""
    avisos = []
    for nome, copia in list(copias.items()):
        if nome == atual.name.lower() or not fnmatch.fnmatch(nome, padrao.lower()):
            continue
        original = atual.parent / copia.name
        if original.exists() and copia.stat().st_mtime > original.stat().st_mtime + FOLGA_S:
            avisos.append(f"'{copia.name}' foi substituída por '{atual.name}', mas a cópia tem edição que o original "
                          f"não tem; deixei no lugar. Tire da pasta quando puder (o hub aceita uma revisão por vez).")
            continue
        guarda.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(copia), str(guarda / f"{datetime.now():%Y%m%d-%H%M%S} {copia.name}"))
        except OSError as e:
            avisos.append(f"'{copia.name}': não consegui tirar da pasta ({e.strerror or e}); tento de novo depois")
            continue
        del copias[nome]
    return avisos


def _copiar(original: Path, destino: Path, entrada: Path, guarda: Path) -> str | None:
    """None: já era a mesma versão. "": copiou. Texto: aviso (não copiou).
    A cópia substituída fica em "guarda" (a última de cada nome)."""
    o = original.stat()
    if destino.exists():
        d = destino.stat()
        if abs(o.st_mtime - d.st_mtime) <= FOLGA_S and o.st_size == d.st_size:
            return None
        if d.st_mtime > o.st_mtime + FOLGA_S:
            return (f"'{destino.name}': a cópia em {entrada.name} ({_quando(d.st_mtime)}) é mais nova que "
                    f"o original ({_quando(o.st_mtime)}); não sobrescrevi. Salve a mudança no original.")
    temporario = destino.with_name(f"~$hub-{destino.name}")
    try:
        if destino.exists():
            guarda.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destino, guarda / destino.name)
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, temporario)  # copy2 mantém o horário do original
        os.replace(temporario, destino)
    except OSError as e:
        temporario.unlink(missing_ok=True)
        return f"'{original.name}': não consegui copiar ({e.strerror or e}); tento de novo na próxima execução"
    return ""
