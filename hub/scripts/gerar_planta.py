"""Gera o piso da maquete (planta/fabrica.png) a partir da planta baixa da fábrica.

Usa só o chão de fábrica: recorta o prédio (galpão, sala do coating, cura e estoque de
bobinas), deixa de fora escritórios, anexos externos, rua e lotes, e apaga as marcações
coloridas do mapa de iscas (pontos, números e rotas tracejadas). Sobram as linhas do
desenho, em branco com transparência: a cor vem do tema, no navegador.

Rodar em hub/ (precisa de Pillow e numpy, que o hub não usa no dia a dia):
  uv run --with pillow --with numpy python scripts/gerar_planta.py "<caminho da planta.png>"
Depois, publicar no Supabase (atrás do login; o repositório é público):
  uv run python scripts/publicar_planta.py

A saída fica em hub/data/planta (fora do git). As constantes RECORTE, CONTORNO e
ESCALA têm de bater com as de demo/assets/maquete.js (PLANTA_PADRAO).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# pixels da imagem original (1492 x 1054)
RECORTE = (316, 296, 970, 657)
# contorno do chão de fábrica, no sentido horário
CONTORNO = [(320, 407), (676, 407), (676, 313), (782, 313), (782, 300), (858, 300), (858, 322),
            (965, 322), (965, 530), (838, 530), (838, 652), (320, 652)]
# a sala "Estoque de bobinas" tem 924 m² e mede 100 x 204 px por dentro
ESCALA = (924 / (100 * 204)) ** 0.5   # metros por pixel (~0,213)
AMPLIA = 3                            # o piso sai 3x maior que o recorte

DESTINO = Path(__file__).resolve().parents[1] / "data" / "planta"


def main(origem: Path):
    img = Image.open(origem).convert("RGB")
    x0, y0, x1, y1 = RECORTE
    w, h = (x1 - x0) * AMPLIA, (y1 - y0) * AMPLIA
    rec = img.crop(RECORTE).resize((w, h), Image.LANCZOS)
    a = np.asarray(rec).astype(np.float32) / 255
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = (mx - mn) / (mx + 1e-6)
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)

    # marcações do mapa de iscas: tudo o que é colorido (o desenho é preto e cinza)
    colorido = Image.fromarray(((sat > 0.26) & (mx > 0.16)).astype(np.uint8) * 255)
    colorido = np.asarray(colorido.filter(ImageFilter.MaxFilter(7))) > 0   # leva junto o halo

    tinta = np.clip((0.88 - lum) / 0.62, 0, 1)
    tinta[colorido] = 0

    # fora do contorno: transparente
    mascara = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mascara).polygon([((x - x0) * AMPLIA, (y - y0) * AMPLIA) for x, y in CONTORNO], fill=255)
    tinta *= np.asarray(mascara, dtype=np.float32) / 255

    alfa = Image.fromarray((tinta * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    saida = Image.merge("RGBA", (Image.new("L", (w, h), 255),) * 3 + (alfa,))
    DESTINO.mkdir(parents=True, exist_ok=True)
    saida.save(DESTINO / "fabrica.png", optimize=True)

    # prévia para conferir (desenho escuro sobre fundo claro)
    previa = Image.new("RGB", (w, h), (236, 241, 247))
    previa.paste(Image.new("RGB", (w, h), (40, 56, 76)), mask=alfa)
    previa.save(DESTINO / "previa.png")

    (DESTINO / "fabrica.json").write_text(json.dumps({
        "recorte_px": RECORTE, "contorno_px": CONTORNO, "metros_por_px": round(ESCALA, 5),
        "largura_m": round((x1 - x0) * ESCALA, 2), "fundo_m": round((y1 - y0) * ESCALA, 2),
    }, indent=2), encoding="utf-8")
    print(f"planta/fabrica.png {w}x{h} · {ESCALA:.4f} m/px · {(x1 - x0) * ESCALA:.1f} x {(y1 - y0) * ESCALA:.1f} m")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
