# Lagos danfo, modelled procedurally. Blender axes: X across, Y along (front = -Y), Z up. Metres.
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix
OUT = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, rough=0.6, metal=0.0, emit=None, es=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = es
    return m
def hexc(h):
    h = h.lstrip("#"); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
M = {
 "paint": mat("paint", hexc("#f7b500"), 0.45, 0.05),
 "stripe": mat("stripe", hexc("#15131b"), 0.6),
 "glass": mat("glass", hexc("#9fc4e8"), 0.1, 0.0),
 "trim": mat("trim", hexc("#2b2935"), 0.7),
 "chrome": mat("chrome", hexc("#c9c4d6"), 0.3, 0.6),
 "tyre": mat("tyre", hexc("#17151d"), 0.9),
 "rim": mat("rim", hexc("#d8d3e2"), 0.4, 0.4),
 "lamp": mat("lamp", hexc("#fff3cf"), 0.3, 0, hexc("#ffe9a8"), 2.0),
 "tail": mat("tail", hexc("#ff3b3b"), 0.4, 0, hexc("#ff1e1e"), 1.5),
 "amber": mat("amber", hexc("#ff9d1c"), 0.4, 0, hexc("#ff8a00"), 1.0),
 "rack": mat("rack", hexc("#2a2833"), 0.6, 0.3),
 "loadA": mat("loadA", hexc("#8a5a2e"), 0.95), "loadB": mat("loadB", hexc("#5a6a8a"), 0.95),
 "loadC": mat("loadC", hexc("#a8433a"), 0.95), "loadD": mat("loadD", hexc("#3f7a55"), 0.95),
 "rope": mat("rope", hexc("#3a2c1c"), 1.0),
 "seat": mat("seat", hexc("#3a2f4a"), 0.9),
 "inner": mat("inner", hexc("#cfc6b4"), 0.9),
 "skinA": mat("skinA", hexc("#6b4226"), 0.8), "skinB": mat("skinB", hexc("#8a5a3a"), 0.8), "skinC": mat("skinC", hexc("#4a2d1a"), 0.8),
 "hair": mat("hair", hexc("#16110f"), 0.9),
 "shirtA": mat("shirtA", hexc("#e11d48"), 0.85), "shirtB": mat("shirtB", hexc("#2563eb"), 0.85), "shirtC": mat("shirtC", hexc("#22c55e"), 0.85),
 "shirtD": mat("shirtD", hexc("#f4f1ea"), 0.85), "shirtE": mat("shirtE", hexc("#7c3aed"), 0.85), "shirtF": mat("shirtF", hexc("#f97316"), 0.85),
 "pants": mat("pants", hexc("#23203a"), 0.9),
}
col = bpy.context.scene.collection
gm_ = M["glass"]; gm_.node_tree.nodes[[n.name for n in gm_.node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]].inputs["Alpha"].default_value = 0.3
try: gm_.surface_render_method = "BLENDED"
except Exception: gm_.blend_method = "BLEND"
def sphere(name, r, loc, material, parent=None, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts); bm.to_mesh(me); bm.free()
    o = obj(name, me, material, parent); o.location = loc; return o
def obj(name, mesh, material=None, parent=None):
    o = bpy.data.objects.new(name, mesh); col.objects.link(o)
    if material: mesh.materials.append(M[material])
    if parent: o.parent = parent
    return o
def box(name, size, loc, material, parent=None, rot=(0, 0, 0), bevel=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
    bm.to_mesh(me); bm.free()
    o = obj(name, me, material, parent); o.location = loc; o.rotation_euler = rot; return o
def cyl(name, r, depth, loc, material, parent=None, rot=(0, math.pi / 2, 0), seg=16, r2=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    bm.to_mesh(me); bm.free()
    o = obj(name, me, material, parent); o.location = loc; o.rotation_euler = rot; return o

L, W, H = 4.8, 1.86, 2.12          # length, width, roof height
G = 0.36                            # sill height (ground clearance of body)
WR, WW = 0.37, 0.25                 # wheel radius / width
AX = (-1.5, 1.42)                   # axle Y (front, rear)
TRACK = W / 2 - 0.13

# ── body shell: side profile (y, z) extruded across X, tapered toward the roof ──
prof = [(-2.40, G), (-2.42, 0.62), (-2.40, 0.98), (-2.30, 1.12), (-1.96, 1.96), (-1.76, H),
        (2.24, H), (2.38, 1.94), (2.40, 1.20), (2.40, G)]
me = bpy.data.meshes.new("body"); bm = bmesh.new()
def taper(z): return 1.0 - 0.085 * max(0.0, (z - 1.05) / (H - 1.05)) ** 1.3
left = [bm.verts.new((-W / 2 * taper(z), y, z)) for y, z in prof]
right = [bm.verts.new((W / 2 * taper(z), y, z)) for y, z in prof]
n = len(prof)
for i in range(n):
    j = (i + 1) % n
    bm.faces.new((left[i], left[j], right[j], right[i]))
bm.faces.new(list(reversed(left))); bm.faces.new(right)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me); bm.free()
body = obj("body", me, "paint")
def taper_side(z): return W / 2 * taper(z)
FLOOR = G + 0.1
# hollow it: subtract an inset copy of the same profile
ime = bpy.data.meshes.new("inner"); bm = bmesh.new()
def inz(z): return FLOOR + (z - G) * ((H - 0.07 - FLOOR) / (H - G))
ip = [(y * 0.972, inz(z)) for y, z in prof]
l2 = [bm.verts.new((-(taper_side(z) - 0.05), y, z)) for y, z in ip]; r2 = [bm.verts.new(((taper_side(z) - 0.05), y, z)) for y, z in ip]
for i in range(n):
    j = (i + 1) % n; bm.faces.new((l2[i], l2[j], r2[j], r2[i]))
bm.faces.new(list(reversed(l2))); bm.faces.new(r2); bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); bm.to_mesh(ime); bm.free()
cutters = [obj("cut_inner", ime)]
zb, zt = 1.24, 1.84                                   # window band
wins = [(-1.62, 0.56), (-0.93, 0.66), (-0.17, 0.72), (0.63, 0.72), (1.45, 0.76)]   # (centre y, length)
DOOR = (-1.30, -0.50)                                 # sliding-door opening on the kerb side (-X)
for i, (y, ln) in enumerate(wins): cutters.append(box(f"cut_w{i}", (W + 0.6, ln, zt - zb), (0, y, (zb + zt) / 2), None))
cutters.append(box("cut_door", (0.7, DOOR[1] - DOOR[0], 1.9 - FLOOR), (-W / 2, (DOOR[0] + DOOR[1]) / 2, (1.9 + FLOOR) / 2), None))
ws_ang = math.atan2(1.96 - 1.12, (-1.96) - (-2.30))
cutters.append(box("cut_ws", (W * 0.84, 0.6, 0.72), (0, -2.13, 1.56), None, rot=(ws_ang - math.pi / 2, 0, 0)))
cutters.append(box("cut_rear", (W * 0.68, 0.5, 0.5), (0, 2.4, 1.56), None))
for k, y in enumerate(AX):
    for s in (-1, 1): cutters.append(cyl(f"cut_a{k}{s}", WR + 0.07, 0.5, (s * (W / 2 - 0.1), y, WR - 0.02), None, seg=20))
for c in cutters:
    md = body.modifiers.new(c.name, "BOOLEAN"); md.object = c; md.operation = "DIFFERENCE"; md.solver = "EXACT"
bv = body.modifiers.new("bev", "BEVEL"); bv.width = 0.03; bv.segments = 1; bv.limit_method = "ANGLE"; bv.angle_limit = math.radians(50)
bpy.context.view_layer.objects.active = body
dg = bpy.context.evaluated_depsgraph_get()
body.data = bpy.data.meshes.new_from_object(body.evaluated_get(dg)); body.modifiers.clear()
for o in [o for o in bpy.data.objects if o.name.startswith("cut")]: bpy.data.objects.remove(o)

def side_x(z, extra=0.012): return W / 2 * taper(z) + extra
# inner wheel-arch liners + dark floor so you never see through the body
for k, y in enumerate(AX):
    for s in (-1, 1):
        cyl(f"arch{k}{s}", WR + 0.065, 0.3, (s * (W / 2 - 0.2), y, WR - 0.02), "trim", body, seg=20)
box("floor", (W - 0.3, L - 0.3, 0.1), (0, 0, G + 0.02), "trim", body)

# ── glass ──
tilt = math.atan2(side_x(zb, 0) - side_x(zt, 0), zt - zb)
for s in (-1, 1):
    for i, (y, ln) in enumerate(wins):
        if s == -1 and i == 1: continue                # the open doorway
        box(f"win{s}{i}", (0.03, ln, zt - zb), (s * (side_x((zb + zt) / 2, -0.02)), y, (zb + zt) / 2), "glass", body, rot=(0, -s * tilt, 0))
    # black danfo stripes + a sill line
    for z, h in ((1.08, 0.075), (0.95, 0.075)):
        if s == 1: box(f"stripe{s}{z}", (0.02, L * 0.93, h), (s * side_x(z, 0.006), 0.02, z), "stripe", body)
        else:
            box(f"stripe{s}{z}a", (0.02, DOOR[0] + 2.22, h), (s * side_x(z, 0.006), (DOOR[0] - 2.22) / 2, z), "stripe", body)
            box(f"stripe{s}{z}b", (0.02, 2.24 - DOOR[1], h), (s * side_x(z, 0.006), (DOOR[1] + 2.24) / 2, z), "stripe", body)
    # sliding-door seam + handle (kerb side reads on both)
    # mirror
    box(f"mirArm{s}", (0.2, 0.03, 0.03), (s * (side_x(1.3) + 0.09), -1.98, 1.3), "trim", body)
    box(f"mir{s}", (0.04, 0.1, 0.2), (s * (side_x(1.3) + 0.2), -1.98, 1.36), "trim", body, bevel=0.01)
    # side indicator
    box(f"ind{s}", (0.02, 0.1, 0.05), (s * side_x(0.86, 0.006), -2.12, 0.86), "amber", body)
# windscreen (on the raked front) and rear window
box("windscreen", (W * 0.84, 0.02, 0.72), (0, -2.13, 1.56), "glass", body, rot=(ws_ang - math.pi / 2, 0, 0))
box("pillarL", (0.03, 0.04, 0.74), (0, -2.135, 1.56), "paint", body, rot=(ws_ang - math.pi / 2, 0, 0))
box("rearwin", (W * 0.68, 0.02, 0.5), (0, 2.385, 1.56), "glass", body)
box("reardoor", (0.012, 0.012, 1.3), (0, 2.408, 1.05), "stripe", body)
# wipers
for s in (-1, 1):
    box(f"wiper{s}", (0.34, 0.012, 0.014), (s * 0.34, -2.262, 1.25), "trim", body, rot=(0, s * 0.25, 0))

# ── interior: liner floor, benches, dash, wheel ──
box("ifloor", (W - 0.16, L - 0.2, 0.04), (0, 0, FLOOR + 0.01), "trim", body)
SEAT_Z = FLOOR + 0.42
def bench(name, x, y, w):
    box(name + "s", (w, 0.42, 0.1), (x, y, SEAT_Z - 0.05), "seat", body, bevel=0.02)
    box(name + "b", (w, 0.08, 0.5), (x, y + 0.2, SEAT_Z + 0.22), "seat", body, bevel=0.02)
    box(name + "l", (w * 0.9, 0.3, SEAT_Z - FLOOR - 0.1), (x, y, (SEAT_Z + FLOOR) / 2 - 0.05), "trim", body)
bench("drv", 0.5, -1.45, 0.52); bench("fp", -0.42, -1.45, 0.62)
for i, y in enumerate((-0.2, 0.6, 1.38)): bench(f"row{i}", 0.2, y, 1.25)        # aisle left on the door side
bench("back", 0, 2.05, W - 0.3)
box("dash", (W - 0.24, 0.3, 0.2), (0, -2.02, 1.08), "trim", body, bevel=0.03)
me = bpy.data.meshes.new("steer"); bm = bmesh.new(); bmesh.ops.create_circle(bm, segments=10, radius=0.17, cap_ends=False)
r_ = bmesh.ops.extrude_edge_only(bm, edges=bm.edges[:]); bmesh.ops.scale(bm, vec=Vector((0.8, 0.8, 1)), verts=[v for v in r_["geom"] if isinstance(v, bmesh.types.BMVert)])
bm.to_mesh(me); bm.free(); st = obj("steer", me, "stripe", body); st.location = (0.5, -1.82, 1.22); st.rotation_euler = (math.radians(65), 0, 0)
sm = st.modifiers.new("s", "SOLIDIFY"); sm.thickness = 0.04
box("steercol", (0.04, 0.04, 0.3), (0.5, -1.9, 1.1), "stripe", body, rot=(math.radians(-25), 0, 0))

# ── people: stylised, flat-colour, seated. Each is its own object (pax_N) so the game can thin them out ──
import random; random.seed(7)
SHIRTS = ["shirtA", "shirtB", "shirtC", "shirtD", "shirtE", "shirtF"]; SKINS = ["skinA", "skinB", "skinC"]
def person(name, x, y, driver=False, lean=0.0):
    root = bpy.data.objects.new(name, None); col.objects.link(root); root.location = (x, y, SEAT_Z)
    sh = random.choice(SHIRTS); sk = random.choice(SKINS)
    t = box(name + "_t", (0.36, 0.22, 0.46), (0, 0.04, 0.25), sh, root, rot=(lean, 0, 0), bevel=0.05)
    sphere(name + "_h", 0.125, (0, 0.02 - lean * 0.3, 0.62), sk, root, scale=(0.95, 1, 1.08))
    kind = random.random()
    if kind < 0.45: sphere(name + "_hair", 0.128, (0, 0.045 - lean * 0.3, 0.66), "hair", root, scale=(1, 1, 0.8))
    elif kind < 0.7: box(name + "_cap", (0.24, 0.3, 0.07), (0, -0.03 - lean * 0.3, 0.725), random.choice(SHIRTS), root, bevel=0.02)       # face cap
    else: sphere(name + "_gele", 0.17, (0, 0.04 - lean * 0.3, 0.7), random.choice(SHIRTS), root, scale=(1.1, 1, 0.7))                       # head tie
    for s in (-1, 1):
        box(name + f"_leg{s}", (0.13, 0.4, 0.13), (s * 0.1, -0.2, 0.03), "pants", root, bevel=0.03)
        box(name + f"_shin{s}", (0.11, 0.11, 0.38), (s * 0.1, -0.38, -0.17), "pants", root, bevel=0.03)
        if driver: box(name + f"_arm{s}", (0.09, 0.36, 0.09), (s * 0.19, -0.2, 0.34), sk, root, rot=(math.radians(-18), 0, 0), bevel=0.03)
        else: box(name + f"_arm{s}", (0.09, 0.1, 0.32), (s * 0.225, 0.02, 0.26), sh, root, bevel=0.03)
    return root
people = [person("driver", 0.5, -1.42, driver=True, lean=-0.12), person("pax_0", -0.42, -1.42)]
k = 1
for y in (-0.17, 0.63, 1.41):
    for x in (-0.22, 0.2, 0.62): people.append(person(f"pax_{k}", x, y)); k += 1
for x in (-0.6, -0.2, 0.2, 0.6): people.append(person(f"pax_{k}", x, 2.08)); k += 1

# ── the open sliding door (slid back along the body) + step + the conductor hanging out ──
dx = -(taper_side(1.0) + 0.045)
box("door", (0.04, DOOR[1] - DOOR[0], 1.9 - FLOOR - 0.5), (dx, DOOR[1] + 0.42, FLOOR + (1.9 - FLOOR - 0.5) / 2 + 0.05), "paint", body, bevel=0.012)
box("doorwin", (0.045, 0.6, 0.5), (dx - 0.004, DOOR[1] + 0.42, 1.52), "glass", body)
box("doorrail", (0.03, 1.7, 0.03), (dx + 0.02, DOOR[1] + 0.05, 1.93), "trim", body)
box("step", (0.3, DOOR[1] - DOOR[0] - 0.06, 0.05), (-W / 2 - 0.1, (DOOR[0] + DOOR[1]) / 2, FLOOR - 0.12), "chrome", body)
box("grab", (0.035, 0.035, 1.3), (-W / 2 + 0.06, DOOR[1] - 0.06, FLOOR + 0.75), "chrome", body)
con = bpy.data.objects.new("conductor", None); col.objects.link(con); con.location = (-W / 2 - 0.06, -0.86, FLOOR - 0.09); con.rotation_euler = (0, math.radians(-13), 0)
for s in (-1, 1):
    box(f"c_leg{s}", (0.14, 0.15, 0.8), (0.02, s * 0.11, 0.4), "pants", con, bevel=0.03)
    box(f"c_foot{s}", (0.24, 0.12, 0.08), (-0.04, s * 0.11, 0.04), "stripe", con, bevel=0.02)
box("c_torso", (0.24, 0.4, 0.56), (0.0, 0, 1.08), "shirtA", con, bevel=0.06)
sphere("c_head", 0.13, (-0.01, 0, 1.52), "skinA", con, scale=(1, 0.95, 1.08))
box("c_cap", (0.3, 0.25, 0.07), (-0.05, 0, 1.635), "stripe", con, bevel=0.02)
box("c_armup", (0.09, 0.09, 0.5), (0.1, 0.24, 1.42), "skinA", con, rot=(math.radians(-22), math.radians(28), 0), bevel=0.03)       # holding the rail
box("c_armout", (0.5, 0.09, 0.09), (-0.3, -0.24, 1.22), "skinA", con, rot=(0, math.radians(-20), math.radians(20)), bevel=0.03)    # calling passengers
box("c_cash", (0.04, 0.1, 0.14), (-0.56, -0.33, 1.34), "shirtC", con)                                                             # naira notes in hand

# ── face: grille, lamps, bumpers, plate recess ──
box("grille", (W * 0.5, 0.03, 0.2), (0, -2.425, 0.8), "trim", body, bevel=0.01)
for i in range(4): box(f"slat{i}", (W * 0.46, 0.012, 0.012), (0, -2.444, 0.735 + i * 0.045), "chrome", body)
cyl("badge", 0.06, 0.02, (0, -2.445, 0.8), "chrome", body, rot=(math.pi / 2, 0, 0), seg=12)
for s in (-1, 1):
    cyl(f"headlamp{s}", 0.115, 0.05, (s * 0.63, -2.42, 0.8), "lamp", body, rot=(math.pi / 2, 0, 0), seg=14)
    cyl(f"headring{s}", 0.135, 0.03, (s * 0.63, -2.412, 0.8), "chrome", body, rot=(math.pi / 2, 0, 0), seg=14)
    box(f"frontind{s}", (0.14, 0.03, 0.06), (s * 0.63, -2.425, 0.62), "amber", body)
    box(f"tail{s}", (0.13, 0.03, 0.34), (s * 0.78, 2.41, 0.98), "tail", body, bevel=0.01)
    box(f"tailamb{s}", (0.13, 0.03, 0.1), (s * 0.78, 2.41, 1.22), "amber", body)
box("bumperF", (W + 0.06, 0.16, 0.17), (0, -2.44, 0.43), "trim", body, bevel=0.03)
box("bumperR", (W + 0.06, 0.16, 0.17), (0, 2.42, 0.43), "trim", body, bevel=0.03)
box("stepR", (W * 0.5, 0.2, 0.04), (0, 2.5, 0.36), "chrome", body)
# roof gutter
for s in (-1, 1): box(f"gutter{s}", (0.03, L * 0.86, 0.03), (s * (side_x(H - 0.04, 0.0)), 0.22, H - 0.05), "trim", body)

# ── roof rack + load ──
rk = H + 0.1
for s in (-1, 1): box(f"rail{s}", (0.04, 2.9, 0.04), (s * 0.7, 0.35, rk), "rack", body)
for i, y in enumerate((-1.05, -0.35, 0.35, 1.05, 1.75)): box(f"cross{i}", (1.44, 0.04, 0.04), (0, y, rk), "rack", body)
for s in (-1, 1):
    for i, y in enumerate((-1.05, 0.35, 1.75)): box(f"leg{s}{i}", (0.04, 0.04, 0.12), (s * 0.7, y, H + 0.04), "rack", body)
loads = [((0.62, 0.7, 0.34), (-0.34, -0.6, rk + 0.19), "loadA", 0.08), ((0.6, 0.62, 0.46), (0.36, -0.55, rk + 0.25), "loadB", -0.1),
         ((0.72, 0.58, 0.3), (0.3, 0.2, rk + 0.17), "loadC", 0.05), ((0.56, 0.66, 0.5), (-0.38, 0.22, rk + 0.27), "loadD", -0.06),
         ((0.66, 0.6, 0.38), (-0.3, 1.0, rk + 0.21), "loadB", 0.12), ((0.6, 0.7, 0.3), (0.38, 1.05, rk + 0.17), "loadA", -0.04),
         ((0.7, 0.5, 0.28), (0.0, -0.1, rk + 0.6), "loadC", 0.3)]
for i, (sz, lc, m, r) in enumerate(loads): box(f"load{i}", sz, lc, m, body, rot=(0, 0, r), bevel=0.03)
cyl("drum", 0.2, 0.62, (0.05, 1.62, rk + 0.22), "loadB", body, rot=(0, math.pi / 2, 0), seg=12)
for y in (-0.55, 0.22, 1.0): box(f"rope{y}", (1.46, 0.025, 0.02), (0, y, rk + 0.56 if y < 0.5 else rk + 0.42), "rope", body)
# route board bracket above the windscreen (text is applied in-game)
box("board", (1.3, 0.1, 0.26), (0, -1.62, H + 0.15), "stripe", body, bevel=0.015)

# ── wheels: separate objects so the game can spin them ──
def wheel(name, x, y):
    w = cyl(name, WR, WW, (x, y, WR), "tyre", seg=18)
    s = 1 if x > 0 else -1
    cyl(name + "_rim", WR * 0.62, 0.02, (0, 0, 0), "rim", seg=14).parent = w
    r = bpy.data.objects[name + "_rim"]; r.location = (0, 0, s * (WW / 2 + 0.004)); r.rotation_euler = (0, 0, 0)
    h = cyl(name + "_hub", WR * 0.2, 0.05, (0, 0, 0), "chrome", seg=8); h.parent = w; h.location = (0, 0, s * (WW / 2 + 0.02)); h.rotation_euler = (0, 0, 0)
    for k in range(5):
        a = k * math.tau / 5
        b = box(f"{name}_lug{k}", (0.05, 0.05, 0.02), (math.cos(a) * WR * 0.4, math.sin(a) * WR * 0.4, s * (WW / 2 + 0.012)), "trim"); b.parent = w
    return w
ws = [wheel("wheel_0", -TRACK, AX[0]), wheel("wheel_1", TRACK, AX[0]), wheel("wheel_2", -TRACK, AX[1]), wheel("wheel_3", TRACK, AX[1])]

# ── join body parts into one mesh, each wheel into one mesh ──
def join(root):
    bpy.ops.object.select_all(action="DESELECT")
    kids = [o for o in bpy.data.objects if o.parent == root]
    for o in kids + [root]: o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.object.join()
def join_empty(root):
    kids = [o for o in bpy.data.objects if o.parent == root]
    bpy.ops.object.select_all(action="DESELECT")
    for o in kids: o.select_set(True)
    bpy.context.view_layer.objects.active = kids[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM"); bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active; nm = root.name; bpy.data.objects.remove(root); j.name = nm
st_dg = bpy.context.evaluated_depsgraph_get(); st.data = bpy.data.meshes.new_from_object(st.evaluated_get(st_dg)); st.modifiers.clear()
for r in [body] + ws: join(r)
for r in people + [con]: join_empty(r)
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    for p in o.data.polygons: p.use_smooth = False
print("TRIS", sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"), [o.name for o in bpy.data.objects])

bpy.ops.export_scene.gltf(filepath=OUT + ".glb", export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_normals=True, export_texcoords=False)

# ── preview renders ──
sc = bpy.context.scene; sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 900, 560
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.42, 0.6, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); col.objects.link(sun); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
gm = bpy.data.meshes.new("g"); bmg = bmesh.new(); bmesh.ops.create_grid(bmg, size=30); bmg.to_mesh(gm); g = obj("ground", gm); gm.materials.append(mat("gr", hexc("#3d3a4a"), 0.9))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); col.objects.link(cam); sc.camera = cam; cam.data.lens = 50
def shot(name, pos):
    cam.location = pos; d = Vector((0, 0, 1.05)) - Vector(pos); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{OUT}-{name}.png"; bpy.ops.render.render(write_still=True)
shot("front34", (5.2, -6.6, 2.6)); shot("door34", (-5.6, -6.2, 2.4)); shot("side", (-9, 0, 1.6))
