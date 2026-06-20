"""Gera os recursos visuais exigidos pela Play Store, no estilo da marca do Dito.

- icon-512.png   : ícone 512x512 (exigido pelo Console)
- feature-1024x500.png : imagem de capa (feature graphic) obrigatória
"""
from PIL import Image, ImageDraw, ImageFont
import os

TERRACOTTA = (201, 100, 66)   # #c96442
CREAM = (250, 249, 245)       # #faf9f5
CREAM_SOFT = (250, 249, 245, 200)
FONT = "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(OUT, exist_ok=True)


def centered(draw, text, font, cx, cy, fill):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    w, h = r - l, b - t
    draw.text((cx - w / 2 - l, cy - h / 2 - t), text, font=font, fill=fill)


# 1) Ícone 512x512 (mesmo desenho do ícone 1024)
icon = Image.new("RGB", (512, 512), TERRACOTTA)
d = ImageDraw.Draw(icon)
centered(d, "D.", ImageFont.truetype(FONT, int(512 * 0.56)), 256, 256, CREAM)
icon.save(os.path.join(OUT, "icon-512.png"))

# 2) Feature graphic 1024x500: marca "Dito" + tagline, fundo terracota
fg = Image.new("RGB", (1024, 500), TERRACOTTA)
d = ImageDraw.Draw(fg)
centered(d, "Dito", ImageFont.truetype(FONT, 150), 512, 215, CREAM)
tagline = "Transcreva, resuma e organize suas conversas"
centered(d, tagline, ImageFont.truetype(FONT_REG, 38), 512, 340, CREAM_SOFT)
fg.save(os.path.join(OUT, "feature-1024x500.png"))

print("Gerados:", [f for f in os.listdir(OUT) if f in
                   ("icon-512.png", "feature-1024x500.png")])
