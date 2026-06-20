"""Gera as imagens-fonte do ícone do Dito a partir da identidade visual do app.

Conceito: fundo terracota (cor-assinatura do app) com "D." em creme, numa
serifada executiva. Saída em frontend/assets/ para o @capacitor/assets gerar
todas as densidades + ícone adaptativo, e o ícone 512 da loja.
"""
from PIL import Image, ImageDraw, ImageFont
import os

# Paleta da identidade visual (frontend/src/index.css)
TERRACOTTA = (201, 100, 66)   # #c96442  — accent do app
CREAM = (250, 249, 245)       # #faf9f5  — bg do app
SIZE = 1024

FONT = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(OUT, exist_ok=True)


def draw_mark(img, scale):
    """Desenha 'D.' centralizado. scale = fração da altura ocupada pela letra."""
    draw = ImageDraw.Draw(img)
    text = "D."
    px = int(SIZE * scale)
    font = ImageFont.truetype(FONT, px)
    # bbox real do glifo para centralizar de verdade (ignora sidebearings)
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    w, h = r - l, b - t
    x = (SIZE - w) / 2 - l
    y = (SIZE - h) / 2 - t
    draw.text((x, y), text, font=font, fill=CREAM)


# 1) Ícone cheio (loja + launcher legado): fundo terracota + D.
full = Image.new("RGB", (SIZE, SIZE), TERRACOTTA)
draw_mark(full, 0.56)
full.save(os.path.join(OUT, "icon.png"))

# 2) Fundo do ícone adaptativo: terracota sólido
bg = Image.new("RGB", (SIZE, SIZE), TERRACOTTA)
bg.save(os.path.join(OUT, "icon-background.png"))

# 3) Frente do ícone adaptativo: D. menor (zona segura ~66% do Android)
fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw_mark(fg, 0.40)
fg.save(os.path.join(OUT, "icon-foreground.png"))

print("Ícones-fonte gerados em frontend/assets/:", os.listdir(OUT))
