"""Gera os recursos visuais da Play Store e do compartilhamento de link, no
estilo da marca do Dito.

- assets/icon-512.png          : ícone 512x512 (exigido pelo Console)
- assets/feature-1024x500.png  : imagem de capa (feature graphic) obrigatória
- public/og.png                : prévia do link (WhatsApp, redes, busca), 1200x630

Rodar depois de make_icon.py.
"""
from PIL import Image, ImageDraw, ImageFont
import os

PINE = (26, 92, 78)        # #1a5c4e
PAPER = (246, 248, 247)    # #f6f8f7
MINT = (108, 190, 165)     # #6cbea5
CREAM = (250, 249, 245)    # a cor da letra do ícone
PAPER_SOFT = (246, 248, 247, 215)

HERE = os.path.dirname(__file__)
SERIF = os.path.join(HERE, "fontes", "SourceSerif4-SemiBold.ttf")
# O ícone usa a serifa pesada do Liberation, como sempre usou (ver make_icon.py).
SERIF_ICONE = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
SANS = os.path.join(HERE, "fontes", "Inter-Medium.ttf")
OUT = os.path.join(HERE, "..", "assets")
PUBLIC = os.path.join(HERE, "..", "public")
os.makedirs(OUT, exist_ok=True)

# A mesma frase do login, do manifest e do <title> da landing.
TAGLINE = "Transcreve e resume qualquer conversa"


def centered(draw, text, font, cx, cy, fill):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (r - l) / 2 - l, cy - (b - t) / 2 - t), text, font=font, fill=fill)


def wordmark(draw, font, cx, cy):
    """'Dito.' centralizado, com o ponto em verde-claro como no app."""
    l, t, r, b = draw.textbbox((0, 0), "Dito.", font=font)
    x = cx - (r - l) / 2 - l
    y = cy - (b - t) / 2 - t
    draw.text((x, y), "Dito", font=font, fill=PAPER)
    draw.text((x + font.getlength("Dito"), y), ".", font=font, fill=MINT)


def card(w, h, mark_px, tag_px, mark_y, tag_y):
    img = Image.new("RGBA", (w, h), PINE)
    d = ImageDraw.Draw(img)
    wordmark(d, ImageFont.truetype(SERIF, mark_px), w / 2, mark_y)
    centered(d, TAGLINE, ImageFont.truetype(SANS, tag_px), w / 2, tag_y, PAPER_SOFT)
    return img.convert("RGB")


# 1) Ícone 512x512, desenhado nesse tamanho (reduzir o de 1024 suja a letra)
icone = Image.new("RGB", (512, 512), PINE)
centered(ImageDraw.Draw(icone), "D.", ImageFont.truetype(SERIF_ICONE, int(512 * 0.56)), 256, 256, CREAM)
icone.save(os.path.join(OUT, "icon-512.png"))

# 2) Feature graphic 1024x500
card(1024, 500, 150, 34, 215, 345).save(os.path.join(OUT, "feature-1024x500.png"))

# 3) Prévia de link 1200x630
card(1200, 630, 180, 40, 270, 430).save(os.path.join(PUBLIC, "og.png"))

print("Gerados: assets/icon-512.png, assets/feature-1024x500.png, public/og.png")
