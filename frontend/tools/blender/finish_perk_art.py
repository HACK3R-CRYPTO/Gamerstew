# After build_perk_art.py: put each render on the shop's deep purple, add the
# glow and the sparkles the first six pictures have, and save a 640px jpg.
#   python3 frontend/tools/blender/finish_perk_art.py <renders_dir> <frontend/public/perks>
import sys, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

src, out = sys.argv[1], sys.argv[2]
S = 1024
import os
for name, tint in [("9", (255, 190, 90)), ("10", (255, 200, 70)), ("11", (120, 200, 255))]:
    if not os.path.exists(f"{src}/{name}.png"): continue
    random.seed(int(name))
    obj = Image.open(f"{src}/{name}.png").convert("RGBA")
    bg = Image.new("RGB", (S, S), (38, 16, 86)); d = ImageDraw.Draw(bg)
    for r in range(560, 0, -8):                                   # a soft lift of light behind the object
        k = 1 - r / 560
        d.ellipse([S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r], fill=(int(38 + 62 * k), int(16 + 22 * k), int(86 + 74 * k)))
    bg = bg.filter(ImageFilter.GaussianBlur(24)).convert("RGBA")
    halo = Image.new("RGBA", (S, S), (0, 0, 0, 0)); mask = obj.split()[3]
    halo.paste(Image.new("RGBA", (S, S), (*tint, 95)), (0, 0), mask)   # the object's own glow
    bg.alpha_composite(halo.filter(ImageFilter.GaussianBlur(46)))
    bg.alpha_composite(obj)
    bright = bg.convert("RGB").point(lambda v: 0 if v < 225 else v)   # bloom on the brightest parts
    out_im = ImageChops.screen(bg.convert("RGB"), bright.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(out_im, "RGBA")
    for _ in range(46):                                           # sparkles, more of them near the object
        a = random.uniform(0, 6.283); r = random.uniform(250, 470)
        x = S / 2 + r * __import__("math").cos(a); y = S / 2 + r * __import__("math").sin(a) * 0.95; z = random.choice([1.5, 2, 2, 3, 5])
        d.ellipse([x - z, y - z, x + z, y + z], fill=(255, 236, 190, random.randint(120, 255)))
        if z >= 5: d.line([x - 14, y, x + 14, y], fill=(255, 240, 200, 200), width=2); d.line([x, y - 14, x, y + 14], fill=(255, 240, 200, 200), width=2)
    out_im.resize((640, 640), Image.LANCZOS).save(f"{out}/{name}.jpg", quality=88)
    print(name, "ok")
