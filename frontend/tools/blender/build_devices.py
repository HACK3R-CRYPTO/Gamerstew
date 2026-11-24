# Builds the Charge-mode props for /world as small GLB files.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/build_devices.py -- <out_dir> [preview.png]
#
# Each prop is at most three meshes, so a phone draws it in two or three calls:
#   body    everything solid, coloured per vertex (one material in the game)
#   glow    the parts that light up while charging (the game swaps the material)
#   blades  the fan only: spun by the game around its own Z
#   stand   the stool a small device waits on; it stays behind when the device is carried
# Blender is Z-up with -Y as the front; the exporter turns that into the game's
# Y-up with +Z as the front. Sizes are metres, matching the old in-code props.

import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp"
PREVIEW = argv[1] if len(argv) > 1 else None

def srgb(h):
    h = h.lstrip("#"); r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)

# ── scene ────────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def vc_material(name, emission=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes.get("Principled BSDF")
    attr = nt.nodes.new("ShaderNodeVertexColor"); attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.6
    if emission:
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    return m
MAT_BODY = vc_material("body"); MAT_GLOW = vc_material("glow", 2.5)

parts = []  # objects of the mesh being built

def finish(obj, color, bevel=0.0, segs=2, smooth=True):
    """Bevel, colour and remember one part."""
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects: o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL"); mod.width = bevel; mod.segments = segs; mod.limit_method = "ANGLE"; mod.angle_limit = math.radians(40)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    me = obj.data
    col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    c = srgb(color)
    for d in col.data: d.color = c
    if smooth:
        for p in me.polygons: p.use_smooth = True
    parts.append(obj)
    return obj

def box(size, loc, color, bevel=0.012, rot=(0, 0, 0), segs=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size
    return finish(o, color, bevel, segs)

def cyl(r, depth, loc, color, rot=(0, 0, 0), verts=20, bevel=0.008, r2=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.object, color, bevel)

def sphere(r, loc, color, scale=(1, 1, 1), seg=16, rings=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object; o.scale = scale
    return finish(o, color)

def torus(R, r, loc, color, rot=(0, 0, 0), maj=28, mnr=6):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=maj, minor_segments=mnr, location=loc, rotation=rot)
    return finish(bpy.context.object, color)

def tube(points, r, color, sides=6):
    """A round cable through the points."""
    cu = bpy.data.curves.new("c", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r; cu.bevel_resolution = max(0, sides // 2 - 1); cu.resolution_u = 6
    sp = cu.splines.new("NURBS"); sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points): p.co = (*co, 1)
    sp.use_endpoint_u = True; sp.order_u = min(4, len(points))
    o = bpy.data.objects.new("cable", cu); scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    for s in bpy.context.selected_objects: s.select_set(False)
    o.select_set(True); bpy.ops.object.convert(target="MESH")
    return finish(bpy.context.object, color)

def join(name, material):
    """Join the parts built so far into one named mesh."""
    global parts
    for s in bpy.context.selected_objects: s.select_set(False)
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1: bpy.ops.object.join()
    o = bpy.context.object; o.name = name; o.data.name = name
    o.data.materials.clear(); o.data.materials.append(material)
    o.data.color_attributes.active_color = o.data.color_attributes["Col"]
    o.data.color_attributes.render_color_index = 0
    parts = []
    return o

DARK, METAL, WHITE, WOOD, WOOD2 = "#23252e", "#8b9099", "#eef0f4", "#9a6a3a", "#6e4622"
models = {}  # name → [objects]

# ── a small wooden stool the little devices sit on ───────────────────────────
def stool(h=0.26, r=0.2):
    cyl(r, 0.035, (0, 0, h), WOOD, bevel=0.01)
    cyl(r * 0.78, 0.02, (0, 0, h - 0.03), WOOD2, bevel=0)
    for i in range(3):
        a = i * 2 * math.pi / 3 + 0.5
        x, y = math.cos(a) * r * 0.62, math.sin(a) * r * 0.62
        cyl(0.02, h, (x * 1.12, y * 1.12, h / 2), WOOD2, rot=(math.sin(a) * -0.16, math.cos(a) * 0.16, 0), verts=8, bevel=0)

# ── phone ────────────────────────────────────────────────────────────────────
def phone():
    stool(); stand = join("stand", MAT_BODY)
    box((0.1, 0.07, 0.06), (0, 0.07, 0.31), WHITE, 0.012)                      # the charger brick it leans on
    tilt = (math.radians(-18), 0, 0)
    box((0.29, 0.03, 0.58), (0, 0.0, 0.575), "#14161c", 0.03, rot=tilt, segs=3)  # body
    box((0.305, 0.022, 0.595), (0, 0.004, 0.575), "#3b4252", 0.03, rot=tilt, segs=3)  # metal rim, just proud of the back
    box((0.09, 0.02, 0.09), (0.075, 0.035, 0.76), "#0b0c10", 0.012, rot=tilt)   # camera island
    cyl(0.022, 0.012, (0.075, 0.048, 0.775), "#2a3140", rot=(math.radians(72), 0, 0), verts=12, bevel=0)
    tube([(0, 0.03, 0.31), (0, 0.11, 0.33), (0.05, 0.13, 0.3), (0.0, 0.1, 0.3)], 0.007, WHITE)
    body = join("body", MAT_BODY)
    box((0.255, 0.004, 0.52), (0, -0.0185, 0.5805), "#4ea1ff", 0.0, rot=tilt)
    glow = join("glow", MAT_GLOW)
    return [body, glow, stand]

# ── rechargeable lantern ─────────────────────────────────────────────────────
def lamp():
    stool(0.2, 0.19); stand = join("stand", MAT_BODY)
    cyl(0.16, 0.09, (0, 0, 0.265), "#d92d20", bevel=0.015)                      # red base, as the street ones are
    cyl(0.168, 0.02, (0, 0, 0.315), DARK, bevel=0)
    for i in range(4):                                                          # guard bars
        a = i * math.pi / 2 + math.pi / 4
        cyl(0.008, 0.32, (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.48), METAL, verts=6, bevel=0)
    cyl(0.168, 0.02, (0, 0, 0.645), DARK, bevel=0)
    cyl(0.16, 0.07, (0, 0, 0.69), "#d92d20", bevel=0.015, r2=0.09)
    sphere(0.03, (0, 0, 0.735), DARK)
    torus(0.13, 0.008, (0, 0, 0.72), METAL, rot=(math.pi / 2, 0, 0), maj=20, mnr=5)  # carry handle
    cyl(0.018, 0.02, (0, -0.16, 0.265), WHITE, rot=(math.pi / 2, 0, 0), verts=10, bevel=0)  # switch
    body = join("body", MAT_BODY)
    cyl(0.125, 0.3, (0, 0, 0.48), "#ffd36a", verts=18, bevel=0.01)
    glow = join("glow", MAT_GLOW)
    return [body, glow, stand]

# ── power bank ───────────────────────────────────────────────────────────────
def powerbank():
    stool(); stand = join("stand", MAT_BODY)
    lean = (math.radians(-12), 0, 0)
    box((0.3, 0.085, 0.52), (0, 0.02, 0.545), "#2b2f3a", 0.035, rot=lean, segs=3)
    box((0.24, 0.006, 0.3), (0, -0.03, 0.5), "#3a4050", 0.01, rot=lean)          # label panel
    box((0.05, 0.03, 0.012), (-0.06, 0.07, 0.81), "#101217", 0.003, rot=lean)   # ports
    box((0.05, 0.03, 0.012), (0.06, 0.07, 0.81), "#101217", 0.003, rot=lean)
    tube([(-0.06, 0.075, 0.82), (-0.09, 0.1, 0.9), (-0.16, 0.12, 0.6), (-0.12, 0.1, 0.32), (-0.05, 0.08, 0.3)], 0.008, WHITE)
    body = join("body", MAT_BODY)
    for i, x in enumerate((-0.09, -0.03, 0.03, 0.09)):
        box((0.036, 0.006, 0.036), (x, -0.068, 0.72), "#9b7aff", 0.006, rot=lean)
    glow = join("glow", MAT_GLOW)
    return [body, glow, stand]

# ── standing fan ─────────────────────────────────────────────────────────────
def fan():
    cyl(0.25, 0.045, (0, 0, 0.0225), DARK, verts=28, bevel=0.015)                # weighted base
    cyl(0.12, 0.05, (0, 0, 0.065), "#2f323d", verts=20, bevel=0.012, r2=0.05)
    cyl(0.028, 0.5, (0, 0, 0.33), METAL, verts=12, bevel=0)                     # lower pole
    cyl(0.04, 0.05, (0, 0, 0.58), DARK, verts=12, bevel=0.006)                  # height collar
    cyl(0.02, 0.38, (0, 0, 0.78), METAL, verts=10, bevel=0)                     # upper pole
    box((0.08, 0.1, 0.12), (0, 0.06, 0.98), DARK, 0.02)                          # neck
    cyl(0.085, 0.2, (0, 0.06, 1.02), "#f4f5f7", rot=(math.pi / 2, 0, 0), verts=16, bevel=0.03)  # motor housing
    cyl(0.03, 0.03, (0, 0.17, 1.02), DARK, rot=(math.pi / 2, 0, 0), verts=10, bevel=0.006)      # oscillation knob
    # the cage: a rim, a front and a back hoop, and spokes bowing between them
    R = 0.3
    torus(R, 0.012, (0, -0.07, 1.02), "#f4f5f7", rot=(math.pi / 2, 0, 0), maj=32, mnr=6)
    torus(R * 0.62, 0.006, (0, -0.135, 1.02), METAL, rot=(math.pi / 2, 0, 0), maj=24, mnr=4)
    torus(R * 0.62, 0.006, (0, -0.005, 1.02), METAL, rot=(math.pi / 2, 0, 0), maj=24, mnr=4)
    for i in range(20):
        a = i * 2 * math.pi / 20; cx, cz = math.cos(a), math.sin(a)
        for y0, y1 in ((-0.07, -0.142), (-0.07, 0.002)):
            p0 = Vector((cx * R, y0, 1.02 + cz * R)); p1 = Vector((cx * 0.06, y1, 1.02 + cz * 0.06)); mid = (p0 + p1) / 2
            d = p1 - p0
            bpy.ops.mesh.primitive_cylinder_add(vertices=4, radius=0.0035, depth=d.length, location=mid)
            o = bpy.context.object; o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
            finish(o, METAL, 0, smooth=False)
    cyl(0.06, 0.012, (0, -0.145, 1.02), "#7af0d0", rot=(math.pi / 2, 0, 0), verts=14, bevel=0.004)  # badge
    body = join("body", MAT_BODY)
    box((0.045, 0.012, 0.02), (0, -0.115, 0.07), "#7af0d0", 0.004)               # power light on the base
    glow = join("glow", MAT_GLOW)
    # blades: built around the origin so the game can spin them, then placed at the hub
    for i in range(3):
        a = i * 2 * math.pi / 3
        bpy.ops.mesh.primitive_plane_add(size=1)
        o = bpy.context.object; bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
        for v in bm.verts:
            u, w = v.co.x + 0.5, v.co.y                                         # u: along the blade, w: across
            width = 0.085 * math.sin(math.pi * (0.12 + 0.88 * u) ** 0.8) + 0.02
            twist = (1 - u) * 0.5 + 0.12
            v.co = Vector((0.04 + u * 0.215, w * 2 * width * math.cos(twist) * 0.5 + (u - 0.5) * 0.05, w * 2 * width * math.sin(twist) * 0.5))
        bm.to_mesh(o.data); bm.free()
        mod = o.modifiers.new("s", "SOLIDIFY"); mod.thickness = 0.006
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=mod.name)
        # blade lies along X in the XY plane; stand it up to face -Y and fan it round the hub
        o.matrix_world = Matrix.Rotation(a, 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "X")
        finish(o, "#cfe3f5", 0)
    cyl(0.045, 0.05, (0, 0, 0), "#f4f5f7", rot=(math.pi / 2, 0, 0), verts=12, bevel=0.012)
    blades = join("blades", MAT_BODY)
    blades.location = (0, -0.07, 1.02)                                           # origin stays at the hub
    return [body, glow, blades]

# ── inverter and its battery ─────────────────────────────────────────────────
def inverter():
    box((0.5, 0.34, 0.4), (-0.02, 0, 0.215), "#3a3f4a", 0.03, segs=3)            # cabinet
    box((0.44, 0.012, 0.33), (-0.02, -0.172, 0.215), "#262a33", 0.01)           # front plate
    for i in range(5): box((0.15, 0.012, 0.016), (0.1, -0.18, 0.12 + i * 0.045), "#12141a", 0.003)  # vents
    cyl(0.03, 0.03, (-0.17, -0.185, 0.12), "#ff9e5e", rot=(math.pi / 2, 0, 0), verts=14, bevel=0.006)  # mode knob
    cyl(0.014, 0.02, (-0.08, -0.185, 0.12), "#d92d20", rot=(math.pi / 2, 0, 0), verts=10, bevel=0)
    torus(0.07, 0.012, (-0.02, 0, 0.42), DARK, rot=(math.pi / 2, 0, 0), maj=16, mnr=5)  # carry handle
    for x in (-0.22, 0.18):
        for y in (-0.12, 0.12): cyl(0.03, 0.03, (x, y, 0.015), DARK, verts=10, bevel=0)  # feet
    # tall tubular battery beside it
    box((0.2, 0.3, 0.5), (0.36, 0, 0.26), "#1c3d7a", 0.025, segs=3)
    box((0.21, 0.31, 0.05), (0.36, 0, 0.5), "#12141a", 0.012)
    for y, c in ((-0.09, "#d92d20"), (0.09, "#12141a")): cyl(0.022, 0.05, (0.36, y, 0.545), c, verts=10, bevel=0.004)
    for i in range(5): cyl(0.016, 0.012, (0.36, -0.1 + i * 0.05, 0.53), "#f2c94c", verts=8, bevel=0)  # filler caps
    tube([(0.36, -0.09, 0.57), (0.3, -0.1, 0.66), (0.14, -0.06, 0.5), (0.1, 0.0, 0.42)], 0.01, "#d92d20")
    tube([(0.36, 0.09, 0.57), (0.3, 0.12, 0.64), (0.16, 0.08, 0.5), (0.12, 0.05, 0.42)], 0.01, "#12141a")
    body = join("body", MAT_BODY)
    box((0.2, 0.006, 0.1), (-0.13, -0.181, 0.29), "#ff9e5e", 0.006)              # display
    box((0.03, 0.006, 0.03), (0.04, -0.181, 0.33), "#ff9e5e", 0.006)             # status light
    glow = join("glow", MAT_GLOW)
    return [body, glow]

# ── fridge ───────────────────────────────────────────────────────────────────
def fridge():
    box((0.66, 0.56, 1.34), (0, 0.02, 0.71), "#dfe3ea", 0.035, segs=3)           # cabinet
    box((0.64, 0.05, 0.36), (0, -0.285, 1.18), WHITE, 0.03, segs=3)              # freezer door
    box((0.64, 0.05, 0.9), (0, -0.285, 0.53), WHITE, 0.03, segs=3)               # main door
    for z, hgt in ((1.16, 0.22), (0.72, 0.36)): box((0.035, 0.05, hgt), (0.25, -0.33, z), METAL, 0.014)  # handles
    box((0.16, 0.008, 0.05), (-0.18, -0.312, 1.3), "#2f6fed", 0.008)             # badge
    for x in (-0.27, 0.27):
        for y in (-0.2, 0.22): cyl(0.035, 0.04, (x, y, 0.02), DARK, verts=10, bevel=0)  # feet
    box((0.5, 0.02, 0.5), (0, 0.305, 0.5), "#1b1d24", 0.004)                     # condenser grille on the back
    for i in range(6): box((0.5, 0.012, 0.012), (0, 0.318, 0.3 + i * 0.08), METAL, 0)
    box((0.62, 0.5, 0.03), (0, 0.02, 1.39), "#c9ced8", 0.01)                     # top
    body = join("body", MAT_BODY)
    box((0.06, 0.006, 0.03), (-0.2, -0.3115, 0.93), "#aee9ff", 0.006)
    glow = join("glow", MAT_GLOW)
    return [body, glow]

# ── the charging table ───────────────────────────────────────────────────────
# Runs along Y here (which becomes the game's Z), 3.1 long, top at 0.46.
def station():
    for i in range(4): box((0.215, 3.1, 0.045), (-0.34 + i * 0.226, 0, 0.44), WOOD if i % 2 else "#a8763f", 0.008)  # planks
    box((0.86, 0.05, 0.1), (0, 1.46, 0.37), WOOD2, 0.006); box((0.86, 0.05, 0.1), (0, -1.46, 0.37), WOOD2, 0.006)   # aprons
    box((0.05, 2.9, 0.1), (0.4, 0, 0.37), WOOD2, 0.006); box((0.05, 2.9, 0.1), (-0.4, 0, 0.37), WOOD2, 0.006)
    for x in (-0.38, 0.38):
        for y in (-1.44, 0, 1.44): box((0.075, 0.075, 0.42), (x, y, 0.21), WOOD2, 0.008)
    box((0.04, 2.9, 0.05), (0, 0, 0.12), WOOD2, 0.004)                           # stretcher
    box((0.82, 0.05, 0.04), (0, 0.72, 0.12), WOOD2, 0.004); box((0.82, 0.05, 0.04), (0, -0.72, 0.12), WOOD2, 0.004)
    # the white extension box along the back edge, three universal sockets and a red switch
    box((0.2, 2.86, 0.085), (0.3, 0, 0.505), WHITE, 0.02, segs=3)
    for y in (-0.95, 0, 0.95):
        box((0.13, 0.22, 0.01), (0.3, y, 0.55), "#d5d9e0", 0.004)
        for dx, dy, s in ((0.03, 0, (0.016, 0.05, 0.012)), (-0.025, -0.035, (0.04, 0.016, 0.012)), (-0.025, 0.035, (0.04, 0.016, 0.012))):
            box(s, (0.3 + dx, y + dy, 0.556), "#15131b", 0)
    box((0.07, 0.11, 0.02), (0.3, 1.33, 0.555), "#d92d20", 0.006)                 # master switch
    tube([(0.3, -1.43, 0.5), (0.34, -1.56, 0.5), (0.42, -1.6, 0.3), (0.44, -1.56, 0.04), (0.5, -1.4, 0.02), (0.5, -1.0, 0.02)], 0.016, "#15131b")
    torus(0.12, 0.016, (0.52, -0.86, 0.02), "#15131b", maj=18, mnr=5); torus(0.1, 0.016, (0.52, -0.86, 0.05), "#15131b", maj=18, mnr=5)  # spare cable, coiled
    # a kerosene tin and a folded cloth, so it reads as somebody's table
    cyl(0.07, 0.16, (-0.24, 1.2, 0.545), "#2f6fed", verts=12, bevel=0.01); cyl(0.02, 0.03, (-0.24, 1.2, 0.64), DARK, verts=8, bevel=0)
    box((0.22, 0.16, 0.03), (-0.2, -1.2, 0.48), "#c2410c", 0.01)
    return [join("body", MAT_BODY)]

BUILD = {"phone": phone, "lamp": lamp, "powerbank": powerbank, "fan": fan, "inverter": inverter, "fridge": fridge, "station": station}
for name, fn in BUILD.items():
    parts = []
    models[name] = fn()

# ── export, one file each ────────────────────────────────────────────────────
import os
os.makedirs(OUT, exist_ok=True)
for name, objs in models.items():
    for s in bpy.context.selected_objects: s.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=os.path.join(OUT, f"charge-{name}.glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_animations=False, export_materials="EXPORT")
    try: bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE", export_all_vertex_colors=False)
    except TypeError as e:
        print("export fallback:", e); bpy.ops.export_scene.gltf(**kw)
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    print(f"MODEL {name}: {len(objs)} meshes, {tris} triangles, {os.path.getsize(kw['filepath']) // 1024} KB")

# ── a look at them all, side by side ─────────────────────────────────────────
if PREVIEW:
    x = -3.0
    for name, objs in models.items():
        if name == "station": continue
        for o in objs: o.location.x += x
        x += 1.2
    for o in models["station"]: o.rotation_euler.z = math.pi / 2; o.location = (0, 1.6, 0)
    bpy.ops.mesh.primitive_plane_add(size=30); g = bpy.context.object
    gm = bpy.data.materials.new("ground"); gm.use_nodes = True; gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.4, 0.46, 1); g.data.materials.append(gm)
    bpy.ops.object.light_add(type="SUN", location=(3, -4, 6)); sun = bpy.context.object; sun.data.energy = 3.5; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True; world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.78, 0.9, 1); world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    bpy.ops.object.camera_add(location=(0.3, -6.2, 2.6)); cam = bpy.context.object; cam.rotation_euler = (math.radians(72), 0, 0); cam.data.lens = 30; scene.camera = cam
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try: scene.render.engine = eng; break
        except TypeError: continue
    scene.render.resolution_x, scene.render.resolution_y = 1700, 900
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", PREVIEW, scene.render.engine)
