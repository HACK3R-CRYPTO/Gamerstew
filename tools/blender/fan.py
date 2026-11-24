# A street spectator for Street Strike, scripted. Faces -Y (front). Exports fan.glb with three objects:
# "body" (legs, torso, head, hair/cap) and "armL" / "armR" whose origins sit at the shoulders, so the
# game can swing them up to cheer. Materials shirt / pants / skin / hair / shoe are recoloured per fan.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly import *
import bpy
OUT = sys.argv[sys.argv.index("--") + 1]
reset()
mat("shirt", "#e11d48", 0.85); mat("pants", "#23203a", 0.9); mat("skin", "#6b4226", 0.8); mat("hair", "#16110f", 0.9); mat("shoe", "#f4f1ea", 0.7)
body = box("body", (0.4, 0.24, 0.56), (0, 0, 1.1), "shirt", bevel=0.06)
for s in (-1, 1):
    box(f"leg{s}", (0.15, 0.17, 0.82), (s * 0.105, 0, -0.68), "pants", body, bevel=0.035)
    box(f"shoe{s}", (0.16, 0.27, 0.09), (s * 0.105, -0.05, -1.055), "shoe", body, bevel=0.025)
box("neck", (0.11, 0.11, 0.08), (0, 0, 0.31), "skin", body)
sphere("head", 0.135, (0, -0.005, 0.46), "skin", body, scale=(0.95, 1, 1.1))
sphere("hair", 0.139, (0, 0.03, 0.5), "hair", body, scale=(1, 1, 0.82))
box("belt", (0.41, 0.25, 0.05), (0, 0, -0.26), "hair", body)
arms = []
for s, n in ((-1, "armL"), (1, "armR")):
    a = box(n, (0.11, 0.12, 0.3), (s * 0.26, 0, 1.31 - 0.14), "shirt", bevel=0.035)     # sleeve
    box(n + "_fore", (0.09, 0.1, 0.3), (0, 0, -0.29), "skin", a, bevel=0.03)
    box(n + "_hand", (0.1, 0.11, 0.1), (0, 0, -0.48), "skin", a, bevel=0.03)
    arms.append(a)
join(body)
for a in arms:
    join(a)
    # move the origin up to the shoulder so rotating the object swings the arm
    bpy.ops.object.select_all(action="DESELECT"); a.select_set(True); bpy.context.view_layer.objects.active = a
    bpy.context.scene.cursor.location = (a.location.x, 0, 1.31)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
finish(OUT, [], [("front", (1.6, -3.2, 1.5))], target_z=0.9)
