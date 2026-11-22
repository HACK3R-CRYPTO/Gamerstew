# Keke napep (Lagos tricycle taxi), scripted. Front = -Y. Exports keke.glb with: body, wheel_0 (front, steers+spins),
# wheel_1, wheel_2, driver, pax_0, pax_1. Materials "paint" and "canopy" are recoloured per vehicle in the game.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly import *
OUT = sys.argv[sys.argv.index("--") + 1]
reset(); base_materials(); random.seed(11)
mat("paint", "#f7b500", 0.45, 0.05); mat("canopy", "#15131b", 0.8); mat("inner", "#cfc6b4", 0.9)
W, L, H = 1.32, 2.72, 1.78
FL = 0.34                                                # floor height
body = box("body", (W - 0.06, 1.75, 0.08), (0, 0.22, FL), "trim")       # floor pan
# rear tub (paint) with a passenger bench inside
box("tubL", (0.06, 1.05, 0.62), (-(W / 2 - 0.03), 0.72, FL + 0.33), "paint", body, bevel=0.015)
box("tubR", (0.06, 1.05, 0.62), ((W / 2 - 0.03), 0.72, FL + 0.33), "paint", body, bevel=0.015)
box("tubBack", (W, 0.07, 0.82), (0, 1.27, FL + 0.43), "paint", body, bevel=0.015)
box("engine", (W - 0.12, 0.34, 0.5), (0, 1.12, FL + 0.27), "trim", body)
for s in (-1, 1):                                        # black stripe along the tub
    box(f"stripe{s}", (0.02, 1.06, 0.07), (s * (W / 2 + 0.004), 0.72, FL + 0.5), "stripe", body)
    box(f"arch{s}", (0.2, 0.62, 0.1), (s * (W / 2 + 0.02), 0.95, 0.5), "trim", body, bevel=0.03)      # rear mudguard
SEAT = FL + 0.36
box("benchS", (W - 0.2, 0.44, 0.12), (0, 0.82, SEAT - 0.06), "seat", body, bevel=0.03)
box("benchB", (W - 0.2, 0.1, 0.5), (0, 1.07, SEAT + 0.2), "seat", body, bevel=0.03)
box("drvS", (0.52, 0.4, 0.12), (0, -0.2, SEAT - 0.06), "seat", body, bevel=0.03)
box("drvB", (0.52, 0.08, 0.42), (0, 0.02, SEAT + 0.16), "seat", body, bevel=0.03)
box("drvBase", (0.46, 0.34, SEAT - FL - 0.1), (0, -0.2, (SEAT + FL) / 2 - 0.05), "trim", body)
box("partition", (W - 0.14, 0.04, 0.5), (0, 0.1, FL + 0.3), "paint", body)
# low side sills beside the driver, and the apron that ties the shield to the floor
for s_ in (-1, 1):
    box(f"sill{s_}", (0.06, 0.92, 0.3), (s_ * (W / 2 - 0.03), -0.36, FL + 0.17), "paint", body, bevel=0.015)
    box(f"sillStripe{s_}", (0.02, 0.92, 0.06), (s_ * (W / 2 + 0.004), -0.36, FL + 0.22), "stripe", body)
    box(f"cheek{s_}", (0.2, 0.07, 0.86), (s_ * 0.55, -0.8, FL + 0.44), "paint", body, rot=(math.radians(-14), 0, s_ * 0.25), bevel=0.03)
box("apron", (W - 0.08, 0.3, 0.07), (0, -0.74, FL + 0.02), "trim", body)
# front: leg shield, nose, mudguard, lamp, handlebar, windscreen
box("shield", (0.92, 0.07, 0.86), (0, -0.83, FL + 0.44), "paint", body, rot=(math.radians(-14), 0, 0), bevel=0.03)
box("nose", (0.5, 0.36, 0.3), (0, -1.0, 0.86), "paint", body, rot=(math.radians(-14), 0, 0), bevel=0.06)
box("noseStripe", (0.94, 0.02, 0.08), (0, -0.9, FL + 0.62), "stripe", body, rot=(math.radians(-14), 0, 0))
cyl("headlamp", 0.1, 0.06, (0, -1.19, 0.9), "lamp", body, rot=(math.pi / 2, 0, 0), seg=12)
cyl("headring", 0.12, 0.04, (0, -1.175, 0.9), "chrome", body, rot=(math.pi / 2, 0, 0), seg=12)
for s in (-1, 1):
    box(f"ind{s}", (0.08, 0.04, 0.06), (s * 0.3, -0.98, 0.98), "amber", body)
    box(f"mir{s}", (0.05, 0.04, 0.14), (s * 0.6, -0.86, 1.34), "trim", body)
    box(f"mirArm{s}", (0.16, 0.025, 0.025), (s * 0.52, -0.86, 1.3), "trim", body)
box("dash", (0.86, 0.1, 0.12), (0, -0.74, 1.1), "trim", body)
box("bar", (0.6, 0.035, 0.035), (0, -0.62, 1.1), "chrome", body)
box("barStem", (0.04, 0.04, 0.4), (0, -0.7, 0.92), "trim", body, rot=(math.radians(-20), 0, 0))
for s in (-1, 1): box(f"grip{s}", (0.12, 0.05, 0.05), (s * 0.3, -0.62, 1.1), "stripe", body)
WS = math.radians(-12)
box("screen", (0.98, 0.02, 0.56), (0, -0.82, 1.42), "glass", body, rot=(WS, 0, 0))
for s in (-1, 1): box(f"scrP{s}", (0.04, 0.04, 0.6), (s * 0.5, -0.82, 1.42), "canopy", body, rot=(WS, 0, 0))
box("scrTop", (1.04, 0.04, 0.04), (0, -0.76, 1.7), "canopy", body)
box("wiper", (0.3, 0.012, 0.014), (0.1, -0.853, 1.2), "trim", body, rot=(0, 0.3, 0))
# canopy: roof, rear hood with a window, corner posts
box("roof", (W + 0.04, 2.14, 0.07), (0, 0.3, H - 0.035), "canopy", body, bevel=0.03)
box("roofLip", (W + 0.04, 0.1, 0.12), (0, -0.74, H - 0.1), "canopy", body, bevel=0.03)
box("hood", (W, 0.05, 0.62), (0, 1.3, 1.42), "canopy", body)
box("hoodWin", (0.6, 0.055, 0.26), (0, 1.3, 1.46), "glass", body)
for s in (-1, 1):
    box(f"postR{s}", (0.045, 0.045, 0.72), (s * (W / 2 - 0.02), 1.26, 1.38), "canopy", body)
    box(f"postM{s}", (0.04, 0.04, 0.9), (s * (W / 2 - 0.02), 0.1, 1.29), "canopy", body)
    box(f"flap{s}", (0.03, 0.5, 0.62), (s * (W / 2 - 0.01), 1.03, 1.42), "canopy", body)          # rolled-down side curtain at the back
    box(f"tail{s}", (0.12, 0.03, 0.16), (s * 0.5, 1.31, 0.9), "tail", body, bevel=0.01)
    box(f"tailamb{s}", (0.12, 0.03, 0.06), (s * 0.5, 1.31, 1.02), "amber", body)
box("bumper", (W + 0.04, 0.08, 0.1), (0, 1.33, 0.42), "trim", body, bevel=0.02)
cyl("exhaust", 0.035, 0.3, (0.42, 1.3, 0.3), "chrome", body, rot=(math.pi / 2, 0, 0), seg=8)
# front fork + mudguard (static part)
box("forkL", (0.03, 0.05, 0.5), (-0.1, -1.1, 0.47), "trim", body, rot=(math.radians(-14), 0, 0))
box("forkR", (0.03, 0.05, 0.5), (0.1, -1.1, 0.47), "trim", body, rot=(math.radians(-14), 0, 0))
box("fmud", (0.2, 0.5, 0.06), (0, -1.14, 0.5), "paint", body, bevel=0.025)
# wheels
ws = [wheel("wheel_0", 0, -1.14, 0.23, 0.13, seg=14, spokes=4), wheel("wheel_1", -(W / 2 - 0.02), 0.95, 0.24, 0.15, side=-1, seg=14, spokes=4), wheel("wheel_2", (W / 2 - 0.02), 0.95, 0.24, 0.15, side=1, seg=14, spokes=4)]
people = [person("driver", 0, -0.2, SEAT, pose="drive", lean=-0.1), person("pax_0", -0.3, 0.84, SEAT), person("pax_1", 0.3, 0.84, SEAT)]
finish(OUT, [body] + ws + people, [("front34", (3.4, -4.4, 2.0)), ("rear34", (-3.6, 4.2, 2.0))], target_z=0.9)
