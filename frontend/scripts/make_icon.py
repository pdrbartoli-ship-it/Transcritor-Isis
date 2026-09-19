"""Gera as imagens-fonte do ícone do Dito a partir da identidade visual do app.

Conceito: fundo verde-pinho (a cor de destaque do app) com "D." na serifa do
logotipo, o "D" no tom do papel e o ponto em verde-claro, como o ponto
colorido do "Dito." na tela. Saída em frontend/assets/ para o @capacitor/assets
gerar todas as densidades + ícone adaptativo, e cópias em frontend/public/
(favicon e ícone do PWA).

Depois de rodar:
  npx capacitor-assets generate --android ...   (ver PLAYSTORE.md)
  npx tauri icon assets/icon.png                (ícones do app de Windows)
"""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil

# Paleta da identidade visual (frontend/src/index.css)
PINE = (26, 92, 78)        # #1a5c4e  accent do tema claro
PAPER = (246, 248, 247)    # #f6f8f7  bg do tema claro
MINT = (108, 190, 165)     # #6cbea5  accent do tema escuro
SIZE = 1024

HERE = os.path.dirname(__file__)
FONT = os.path.join(HERE, "fontes", "SourceSerif4-SemiBold.ttf")
OUT = os.path.join(HERE, "..", "assets")
PUBLIC = os.path.join(HERE, "..", "public")
os.makedirs(OUT, exist_ok=True)


def draw_mark(img, scale):
    """Desenha 'D.' centralizado. scale = fração da altura ocupada pela letra."""
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(SIZE * scale))
    # bbox real do glifo para centralizar de verdade (ignora sidebearings)
    l, t, r, b = draw.textbbox((0, 0), "D.", font=font)
    x = (SIZE - (r - l)) / 2 - l
    y = (SIZE - (b - t)) / 2 - t
    draw.text((x, y), "D", font=font, fill=PAPER)
    draw.text((x + font.getlength("D"), y), ".", font=font, fill=MINT)


# 1) Ícone cheio (loja + launcher legado): fundo verde + D.
full = Image.new("RGB", (SIZE, SIZE), PINE)
draw_mark(full, 0.56)
full.save(os.path.join(OUT, "icon.png"))

# 2) Fundo do ícone adaptativo: verde sólido
Image.new("RGB", (SIZE, SIZE), PINE).save(os.path.join(OUT, "icon-background.png"))

# 3) Frente do ícone adaptativo: D. menor (zona segura ~66% do Android)
fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw_mark(fg, 0.40)
fg.save(os.path.join(OUT, "icon-foreground.png"))

# 4) Web: favicon e ícone do manifest
shutil.copy(os.path.join(OUT, "icon.png"), os.path.join(PUBLIC, "favicon.png"))
full.resize((512, 512), Image.LANCZOS).save(os.path.join(PUBLIC, "icon-512.png"))

print("Ícones-fonte gerados em frontend/assets/ e frontend/public/")
