from PIL import Image, ImageDraw

base = Image.open("/Users/pradyumna/chicken_road-2/static/image/chicken_idle.png").convert("RGBA")
d = ImageDraw.Draw(base)
for cx, cy in [(145, 70), (168, 72)]:
    d.ellipse((cx - 14, cy - 14, cx + 14, cy + 14), fill=(255, 220, 40, 255), outline=(30, 30, 30, 255))
    d.ellipse((cx - 4, cy - 4, cx + 6, cy + 6), fill=(20, 20, 20, 255))
    d.ellipse((cx - 2, cy - 6, cx + 2, cy - 2), fill=(255, 255, 255, 220))
d.ellipse((158, 88, 172, 108), fill=(220, 40, 50, 255))
d.ellipse((95, 175, 115, 190), fill=(255, 180, 40, 255))
d.ellipse((125, 178, 145, 193), fill=(255, 180, 40, 255))
base.save("/Users/pradyumna/chicken_road-2/static/image/chicken_idle.png")
print("ok")
