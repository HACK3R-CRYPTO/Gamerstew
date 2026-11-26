# After build_pets.py: trim each render to the pet, centre it on a square, and lay a
# small soft shadow under it. Run with the system Python:
#   python3 frontend/tools/blender/finish_pets.py <renders_dir> <frontend/public/pets>
#
# Writes, for each stage:
#   <out>/stage-N-name.png          the resting face, 640px (used by share cards and older screens)
#   <out>/m/<id>-<mood>.webp        every mood, 512px
#   <out>/m/<id>-<mood>-s.webp      every mood, 128px, for avatars
# Every mood of a stage is trimmed with the SAME box (the resting face's), so the frames
# sit exactly on top of each other and a blink changes the eyes and nothing else.
import os, sys
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
SIZE, PAD = 640, 44
STAGES = [("stage-1-egg", "egg"), ("stage-2-baby", "baby"), ("stage-3-teen", "teen"), ("stage-4-crystal", "crystal"), ("stage-5-king", "king")]
MOODS = ["happy", "blink", "joy", "sad", "sleepy"]
os.makedirs(f"{out}/m", exist_ok=True)

def place(im, box):
    pet = im.crop(box)
    room = SIZE - PAD * 2
    k = min(room / pet.width, (room - 26) / pet.height)
    pet = pet.resize((max(1, round(pet.width * k)), max(1, round(pet.height * k))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    x = (SIZE - pet.width) // 2; y = SIZE - PAD - pet.height - 10
    sh = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))   # the shadow: an ellipse under the feet, blurred, in the app's deep purple
    w = pet.width * 0.78; cy = y + pet.height - 6
    ImageDraw.Draw(sh).ellipse([SIZE / 2 - w / 2, cy - 15, SIZE / 2 + w / 2, cy + 21], fill=(27, 13, 66, 105))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(13)))
    canvas.alpha_composite(pet, (x, y))
    return canvas

total = 0
for name, pid in STAGES:
    base = Image.open(f"{src}/{name}.png").convert("RGBA")
    box = base.split()[3].point(lambda a: 255 if a > 10 else 0).getbbox()
    place(base, box).save(f"{out}/{name}.png", optimize=True)
    for mood in MOODS:
        f = f"{src}/{name}.png" if mood == "happy" else f"{src}/{name}-{mood}.png"
        if not os.path.exists(f): continue
        im = place(Image.open(f).convert("RGBA"), box)
        for size, tag in ((512, ""), (128, "-s")):
            p = f"{out}/m/{pid}-{mood}{tag}.webp"
            im.resize((size, size), Image.LANCZOS).save(p, "WEBP", quality=88, method=6)
            total += os.path.getsize(p)
    print(name, "ok")
print("moods:", round(total / 1024), "KB in all")
