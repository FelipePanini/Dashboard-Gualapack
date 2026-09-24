"""Onde está cada arquivo e como trazer uma cópia pra leitura.

O arquivo de uma fonte é procurado PELO NOME dentro da pasta de entrada,
em qualquer subpasta: dá pra reorganizar "Dados do Painel" à vontade sem
mexer na configuração. Caminho absoluto também vale.

Regras:
- fonte comum: o nome precisa achar exatamente UM arquivo (zero ou dois é
  erro, nunca palpite — dois achados costuma ser uma cópia esquecida);
- fonte com "varios: true" (ex.: um Sequenciamento por mês): todos os que
  casarem com o padrão, lidos e empilhados.

Cada arquivo é copiado uma vez por execução para uma pasta temporária e é
sempre a cópia que se lê: o Excel pode estar com o original aberto, e o
original nunca é tocado.
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
    original: Path
    modificado_em: datetime
    sha256: str


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _candidatos(padrao: str, raiz: Path | None) -> list[Path]:
    p = Path(padrao)
    if not p.is_absolute() and raiz is not None:
        achados = raiz.rglob(p.name)                      # qualquer subpasta da pasta de entrada
    elif any(c in p.name for c in "*?["):
        achados = p.parent.glob(p.name)
    else:
        achados = [p] if p.exists() else []
    return sorted(a for a in achados if a.is_file() and not a.name.startswith("~$"))


def _onde(achados: list[Path], raiz: Path | None) -> str:
    return "; ".join(str(a.relative_to(raiz)) if raiz and a.is_relative_to(raiz) else str(a) for a in achados)


def resolver(padrao: str, raiz: Path | None = None) -> Path:
    achados = _candidatos(padrao, raiz)
    if len(achados) != 1:
        detalhe = f": {_onde(achados, raiz)}" if achados else ""
        raise FileNotFoundError(f"{len(achados)} arquivo(s) para '{Path(padrao).name}'{detalhe}")
    return achados[0]


def resolver_todos(padrao: str, raiz: Path | None = None) -> list[Path]:
    achados = _candidatos(padrao, raiz)
    if not achados:
        raise FileNotFoundError(f"nenhum arquivo para '{Path(padrao).name}'")
    return achados


def localizar(fonte: dict, raiz: Path | None = None) -> list[Path]:
    """Arquivos originais de uma fonte (um só, ou vários com varios: true)."""
    if fonte.get("varios"):
        return resolver_todos(fonte["arquivo"], raiz)
    return [resolver(fonte["arquivo"], raiz)]


class Origens:
    def __init__(self, raiz: Path | None = None):
        self.raiz = raiz
        self._tmp = Path(tempfile.mkdtemp(prefix="gualapack_hub_"))
        self._cache: dict[Path, ArquivoObtido] = {}

    def __enter__(self) -> "Origens":
        return self

    def __exit__(self, *_) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)

    def localizar(self, fonte: dict) -> list[Path]:
        return localizar(fonte, self.raiz)

    def obter(self, original: Path) -> ArquivoObtido:
        if original not in self._cache:
            destino = self._tmp / f"{len(self._cache)}_{original.name}"
            shutil.copy2(original, destino)
            self._cache[original] = ArquivoObtido(
                destino, original, datetime.fromtimestamp(original.stat().st_mtime), _sha256(destino))
        return self._cache[original]
