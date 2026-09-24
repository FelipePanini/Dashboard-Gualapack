"""De onde vem cada arquivo: uma pasta local (a pasta de entrada na Área de
Trabalho, ou qualquer caminho da rede/OneDrive).

Cada arquivo é copiado UMA vez por execução para uma pasta temporária (duas
fontes do mesmo arquivo não copiam duas vezes) e é sempre essa cópia que se
lê: o Excel pode estar com o original aberto, e o original nunca é tocado.
"""
from __future__ import annotations

import hashlib
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class ArquivoObtido:
    caminho: Path              # cópia local temporária — é esta que se lê
    descricao: str             # o que fica registrado em files.caminho
    modificado_em: datetime | None
    sha256: str


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def resolver(padrao: str) -> Path:
    """Exatamente um arquivo por padrão ('*' e '?' valem). Zero ou dois é erro, nunca palpite."""
    p = Path(padrao)
    if any(c in p.name for c in "*?["):
        achados = [a for a in p.parent.glob(p.name) if not a.name.startswith("~$")]
    else:
        achados = [p] if p.exists() else []
    if len(achados) != 1:
        raise FileNotFoundError(f"{len(achados)} arquivo(s) para '{p.name}' em {p.parent}")
    return achados[0]


class Origens:
    def __init__(self):
        self._tmp = Path(tempfile.mkdtemp(prefix="gualapack_hub_"))
        self._cache: dict[str, ArquivoObtido] = {}

    def __enter__(self) -> "Origens":
        return self

    def __exit__(self, *_) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)

    def obter(self, fonte: dict) -> ArquivoObtido:
        if fonte["arquivo"] not in self._cache:
            original = resolver(fonte["arquivo"])
            destino = self._tmp / f"{len(self._cache)}_{original.name}"
            shutil.copy2(original, destino)
            self._cache[fonte["arquivo"]] = ArquivoObtido(
                destino, str(original), datetime.fromtimestamp(original.stat().st_mtime), _sha256(destino))
        return self._cache[fonte["arquivo"]]
