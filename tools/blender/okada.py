# Okada (commercial motorcycle) with rider and passenger, scripted. Front = -Y.
# Exports okada.glb with: body, wheel_0 (front), wheel_1 (rear), driver, pax_0. "paint" is recoloured per bike.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly import *
OUT = sys.argv[sys.argv.index("--") + 1]
reset(); base_materials(); random.seed(5)
mat("paint", "#e11d48", 0.4, 0.1); mat("helmet", "#facc15", 0.4)
R = 0.3
body = box("body", (0.16, 0.72, 0.2), (0, 0.02, 0.5), "trim", bevel=0.04)                 # engine block
box("tank", (0.3, 0.52, 0.24), (0, -0.2, 0.86), "paint", body, bevel=0.08)
box("tankStripe", (0.31, 0.3, 0.05), (0, -0.2, 0.86), "stripe", body)
box("seat", (0.3, 0.86, 0.11), (0, 0.42, 0.86), "seat", body, bevel=0.04)
box("frameT", (0.06, 1.2, 0.06), (0, 0.1, 0.72), "trim", body)
box("frameD", (0.06, 0.06, 0.5), (0, -0.42, 0.62), "trim", body, rot=(math.radians(28), 0, 0))
box("sideL", (0.04, 0.34, 0.2), (-0.14, 0.34, 0.66), "paint", body, bevel=0.03); box("sideR", (0.04, 0.34, 0.2), (0.14, 0.34, 0.66), "paint", body, bevel=0.03)
box("rearMud", (0.16, 0.5, 0.05), (0, 0.9, 0.7), "paint", body, bevel=0.02)
box("rack", (0.3, 0.3, 0.03), (0, 0.98, 0.84), "chrome", body)
box("tail", (0.14, 0.04, 0.08), (0, 1.14, 0.72), "tail", body)
box("plate", (0.2, 0.02, 0.12), (0, 1.15, 0.58), "rim", body)
cyl("exhaust", 0.05, 0.75, (0.17, 0.55, 0.42), "chrome", body, rot=(math.radians(84), 0, 0), seg=8)
for s in (-1, 1):
    box(f"shock{s}", (0.035, 0.035, 0.36), (s * 0.12, 0.72, 0.56), "chrome", body, rot=(math.radians(-22), 0, 0))
    box(f"swing{s}", (0.035, 0.5, 0.04), (s * 0.1, 0.58, 0.34), "trim", body)
    box(f"fork{s}", (0.035, 0.035, 0.74), (s * 0.09, -0.62, 0.62), "chrome", body, rot=(math.radians(-22), 0, 0))
    box(f"peg{s}", (0.16, 0.05, 0.03), (s * 0.2, 0.12, 0.36), "trim", body)
    box(f"grip{s}", (0.14, 0.05, 0.05), (s * 0.3, -0.5, 1.06), "stripe", body)
    box(f"mirA{s}", (0.02, 0.02, 0.2), (s * 0.24, -0.5, 1.16), "trim", body); box(f"mir{s}", (0.1, 0.02, 0.07), (s * 0.26, -0.5, 1.28), "trim", body)
    box(f"ind{s}", (0.06, 0.04, 0.04), (s * 0.16, -0.72, 0.92), "amber", body)
box("bars", (0.62, 0.035, 0.035), (0, -0.5, 1.06), "chrome", body)
box("frontMud", (0.14, 0.44, 0.05), (0, -0.82, 0.62), "paint", body, bevel=0.02)
cyl("headlamp", 0.1, 0.1, (0, -0.72, 0.98), "lamp", body, rot=(math.pi / 2, 0, 0), seg=12)
box("cowl", (0.24, 0.08, 0.2), (0, -0.67, 0.98), "paint", body, bevel=0.03)
ws = [wheel("wheel_0", 0, -0.82, R, 0.1, seg=16, spokes=6), wheel("wheel_1", 0, 0.78, R, 0.12, seg=16, spokes=6)]
SEAT = 0.9
people = [person("driver", 0, 0.1, SEAT, pose="ride", lean=-0.3, helmet="helmet"), person("pax_0", 0, 0.66, SEAT, pose="sit", lean=-0.06)]
finish(OUT, [body] + ws + people, [("front34", (2.6, -3.2, 1.6)), ("rear34", (-2.8, 3.0, 1.6))], target_z=0.75)
