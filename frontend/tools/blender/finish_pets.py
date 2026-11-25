# After build_pets.py: trim each render to the pet, centre it on a square, and lay a
# small soft shadow under it. Run with the system Python:
#   python3 frontend/tools/blender/finish_pets.py <renders_dir> <out_dir>
import sys
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
SIZE, PAD = 640, 44
for name in ["stage-1-egg", "stage-2-baby", "stage-3-teen", "stage-4-crystal", "stage-5-king"]:
    im = Image.open(f"{src}/{name}.png").convert("RGBA")
    box = im.split()[3].point(lambda a: 255 if a > 10 else 0).getbbox()
    pet = im.crop(box)
    room = SIZE - PAD * 2
    k = min(room / pet.width, (room - 26) / pet.height)
    pet = pet.resize((max(1, round(pet.width * k)), max(1, round(pet.height * k))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - pet.width) // 2; y = SIZE - PAD - pet.height - 10
    # the shadow: an ellipse under the feet, blurred, in the app's deep purple
    sh = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    w = pet.width * 0.78; cy = y + pet.height - 6
    ImageDraw.Draw(sh).ellipse([SIZE / 2 - w / 2, cy - 15, SIZE / 2 + w / 2, cy + 21], fill=(27, 13, 66, 105))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(13)))
    canvas.alpha_composite(pet, (x, y))
    canvas.save(f"{out}/{name}.png", optimize=True)
    print(name, canvas.size)
