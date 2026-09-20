"""Gera as imagens-fonte do ícone do Dito a partir da identidade visual do app.

Conceito: fundo verde-pinho (a cor de destaque do app) com "D." em creme, numa
serifada executiva. É o desenho de sempre; em 2026-09-19 só a cor de fundo
mudou (era terracota). A serifa pesada do Liberation é de propósito: a do
logotipo, fina e de alto contraste, some no ícone de 16 px da barra de tarefas.
Saída em frontend/assets/ para o @capacitor/assets gerar todas as densidades +
ícone adaptativo, e cópias em frontend/public/ (favicon e ícone do PWA).

Depois de rodar:
  npx capacitor-assets generate --android ...   (ver PLAYSTORE.md)
  npx tauri icon assets/icon.png                (ícones do app de Windows)
"""
from PIL import Image, ImageDraw, ImageFont
import os
import shutil

# Paleta da identidade visual (frontend/src/index.css)
PINE = (26, 92, 78)        # #1a5c4e  accent do tema claro
CREAM = (250, 249, 245)    # a cor da letra, mantida do ícone original
SIZE = 1024

HERE = os.path.dirname(__file__)
FONT = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
OUT = os.path.join(HERE, "..", "assets")
PUBLIC = os.path.join(HERE, "..", "public")
os.makedirs(OUT, exist_ok=True)


def draw_mark(img, scale, size=SIZE):
    """Desenha 'D.' centralizado. scale = fração da altura ocupada pela letra."""
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(size * scale))
    # bbox real do glifo para centralizar de verdade (ignora sidebearings)
    l, t, r, b = draw.textbbox((0, 0), "D.", font=font)
    x = (size - (r - l)) / 2 - l
    y = (size - (b - t)) / 2 - t
    draw.text((x, y), "D.", font=font, fill=CREAM)


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

# 4) Web: favicon e ícone do manifest. O de 512 é desenhado nesse tamanho, não
# reduzido do de 1024: reduzir engrossa a serifa e suja a borda da letra.
shutil.copy(os.path.join(OUT, "icon.png"), os.path.join(PUBLIC, "favicon.png"))
meio = Image.new("RGB", (512, 512), PINE)
draw_mark(meio, 0.56, size=512)
meio.save(os.path.join(PUBLIC, "icon-512.png"))

# 5) Ícone da guia do navegador. O Chrome guarda o favicon pela URL do arquivo,
# então trocar a cor mantendo o nome "favicon.png" deixava a guia laranja para
# quem já tinha visitado o site. Por isso a guia aponta para um nome novo
# (favicon-v2.png); se a cor mudar de novo, suba o número aqui e no index.html.
aba = Image.new("RGB", (256, 256), PINE)
draw_mark(aba, 0.56, size=256)
aba.save(os.path.join(PUBLIC, "favicon-v2.png"))
aba.save(os.path.join(PUBLIC, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])

print("Ícones-fonte gerados em frontend/assets/ e frontend/public/")
