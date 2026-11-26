# Shop art for items that have none yet, in the look of the first six (a glossy
# glass object glowing on deep purple). Built and rendered in Blender:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python frontend/tools/blender/build_perk_art.py -- <out_dir>
# then finished (background, glow, sparkles) by finish_perk_art.py.
#   9   One more life (UP NEPA 3D): a light bulb, lit
#   10  Energy pack: a lightning bolt
#   11  Streak freeze: a flame kept inside a block of ice
import bpy, bmesh, math, sys
from mathutils import Vector

OUT = (sys.argv[sys.argv.index("--") + 1:] or ["/tmp/perkart"])[0] if "--" in sys.argv else "/tmp/perkart"

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices: d.use = True
        s.cycles.device = "GPU"
    except Exception:
        s.cycles.device = "CPU"
    s.cycles.samples = 180; s.cycles.use_denoising = True; s.cycles.max_bounces = 14; s.cycles.transmission_bounces = 12
    s.render.film_transparent = True
    s.render.resolution_x = s.render.resolution_y = 1024
    s.render.image_settings.file_format = "PNG"; s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); s.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.35, 0.22, 0.6, 1); bg.inputs["Strength"].default_value = 0.45
    for name, loc, energy, size, color in [("key", (-3, -4.5, 4.5), 900, 4, (1, 1, 1)), ("fill", (4, -3, 1.5), 500, 5, (0.8, 0.85, 1)), ("rim", (2, 4, 3), 1100, 3, (1, 0.6, 0.9)), ("under", (0, -2, -3.5), 500, 4, (0.6, 0.5, 1))]:
        d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.size = size; d.color = color
        o = bpy.data.objects.new(name, d); s.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    c = bpy.data.cameras.new("cam"); c.lens = 70
    o = bpy.data.objects.new("cam", c); s.collection.objects.link(o); o.location = (0, -8.2, 0.5)
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(o.location)).to_track_quat("-Z", "Y").to_euler(); s.camera = o
    return s

def bsdf(m): return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
def put(node, **kw):
    for k, v in kw.items():
        n = k.replace("_", " ")
        if n in node.inputs: node.inputs[n].default_value = v
def glass(name, color, glow, strength=1.2, rough=0.04):
    m = bpy.data.materials.new(name); m.use_nodes = True
    put(bsdf(m), Base_Color=(*color, 1), Roughness=rough, IOR=1.45, Transmission_Weight=0.85, Coat_Weight=1.0, Coat_Roughness=0.03, Emission_Color=(*glow, 1), Emission_Strength=strength)
    return m
def solid(name, color, rough=0.3, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    put(bsdf(m), Base_Color=(*color, 1), Roughness=rough, Metallic=metal)
    if emit: put(bsdf(m), Emission_Color=(*emit, 1), Emission_Strength=strength)
    return m

def ring(r, tilt, mat, thick=0.045):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=thick, rotation=tilt, major_segments=96, minor_segments=16)
    o = bpy.context.object; bpy.ops.object.shade_smooth(); o.data.materials.append(mat); return o

def render(name):
    bpy.context.scene.render.filepath = f"{OUT}/{name}.png"; bpy.ops.render.render(write_still=True); print("rendered", name)

def bolt():
    reset()
    pts = [(0.28, 1.45), (-0.72, 0.02), (-0.08, 0.02), (-0.42, -1.45), (0.74, 0.22), (0.12, 0.22), (0.62, 1.45)]
    mesh = bpy.data.meshes.new("bolt"); bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]; bm.faces.new(vs); bm.to_mesh(mesh); bm.free()
    o = bpy.data.objects.new("bolt", mesh); bpy.context.scene.collection.objects.link(o)
    so = o.modifiers.new("thick", "SOLIDIFY"); so.thickness = 0.46; so.offset = 0
    bv = o.modifiers.new("round", "BEVEL"); bv.width = 0.11; bv.segments = 6
    o.rotation_euler = (math.radians(6), 0, math.radians(-14))
    o.data.materials.append(glass("amber", (1.0, 0.62, 0.06), (1.0, 0.5, 0.02), 0.35))
    for p in o.data.polygons: p.use_smooth = True
    halo = glass("halo", (0.75, 0.5, 1.0), (0.6, 0.3, 1.0), 0.9, rough=0.1)
    ring(1.6, (math.radians(22), math.radians(24), 0), halo, 0.035); ring(1.78, (math.radians(-16), math.radians(-30), 0), halo, 0.025)
    render("10")

def bulb():
    reset()
    g = glass("bulb", (1.0, 0.9, 0.62), (1.0, 0.72, 0.2), 0.12, rough=0.03)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(0, 0, 0.45), segments=64, ring_count=32)
    b = bpy.context.object
    for v in b.data.vertices:
        if v.co.z < 0: k = 1 - 0.55 * min(1, -v.co.z); v.co.x *= k; v.co.y *= k; v.co.z *= 1.25   # the neck
    bpy.ops.object.shade_smooth(); b.data.materials.append(g)
    hot = solid("filament", (1, 0.85, 0.4), emit=(1.0, 0.7, 0.15), strength=9)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.3, minor_radius=0.035, location=(0, 0, 0.5), rotation=(math.radians(90), 0, 0)); f = bpy.context.object; bpy.ops.object.shade_smooth(); f.data.materials.append(hot)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.72, location=(sx * 0.2, 0, 0.02)); c = bpy.context.object; c.data.materials.append(solid("wire", (0.5, 0.5, 0.55), metal=1.0, rough=0.3))
    metal = solid("cap", (0.72, 0.74, 0.8), rough=0.28, metal=1.0)
    for i in range(4):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.42 - i * 0.02, minor_radius=0.075, location=(0, 0, -0.92 - i * 0.15)); t = bpy.context.object; bpy.ops.object.shade_smooth(); t.data.materials.append(metal)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, location=(0, 0, -1.55)); e = bpy.context.object; e.scale = (1, 1, 0.6); bpy.ops.object.shade_smooth(); e.data.materials.append(solid("tip", (0.12, 0.1, 0.16), rough=0.4))
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH": o.rotation_euler.rotate_axis("Y", math.radians(-12)); o.location = Vector(o.location) @ __import__("mathutils").Matrix.Rotation(math.radians(12), 3, "Y")
    halo = glass("halo", (1.0, 0.7, 0.4), (1.0, 0.5, 0.15), 0.9, rough=0.1)
    ring(1.62, (math.radians(22), math.radians(24), 0), halo, 0.035); ring(1.8, (math.radians(-16), math.radians(-30), 0), halo, 0.025)
    render("9")

def freeze():
    reset()
    ice = bpy.data.materials.new("ice"); ice.use_nodes = True
    put(bsdf(ice), Base_Color=(0.36, 0.68, 1.0, 1), Roughness=0.09, IOR=1.31, Transmission_Weight=0.9, Coat_Weight=1.0, Coat_Roughness=0.05)
    bpy.ops.mesh.primitive_cube_add(size=1.95, location=(0, 0, 0))
    c = bpy.context.object; c.rotation_euler = (math.radians(16), math.radians(-12), math.radians(32))
    bv = c.modifiers.new("round", "BEVEL"); bv.width = 0.24; bv.segments = 8
    c.data.materials.append(ice)
    for p in c.data.polygons: p.use_smooth = True
    # the flame it is keeping: a teardrop, hot at the heart
    for r, z, col, strength in [(0.42, -0.22, (1.0, 0.32, 0.02), 1.6), (0.23, -0.28, (1.0, 0.72, 0.12), 3.2)]:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(0, 0, z), segments=48, ring_count=24)
        f = bpy.context.object
        for v in f.data.vertices:
            if v.co.z > 0: k = max(0.0, 1 - (v.co.z / r) ** 1.4); v.co.x *= k; v.co.y *= k; v.co.z *= 2.0   # pulled up to a point
        bpy.ops.object.shade_smooth(); f.data.materials.append(solid("flame", col, rough=0.4, emit=col, strength=strength))
    halo = glass("halo", (0.55, 0.8, 1.0), (0.35, 0.65, 1.0), 0.9, rough=0.1)
    ring(1.68, (math.radians(22), math.radians(24), 0), halo, 0.035); ring(1.86, (math.radians(-16), math.radians(-30), 0), halo, 0.025)
    render("11")

only = [a for a in sys.argv[sys.argv.index("--") + 2:]] if "--" in sys.argv else []
for name, fn in [("10", bolt), ("9", bulb), ("11", freeze)]:
    if not only or name in only: fn()
