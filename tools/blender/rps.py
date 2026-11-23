# Challenge AI's rock and scissors, scripted (the paper is a live sheet built in the game,
# because it has to bend round the rock).
#   rock     : a chunky faceted boulder in three stone tones, with an angry face
#   scissors : two bevelled steel blades with a bright cutting edge, red loop handles, gold pivot
# Front faces -Y (the game camera). Scissors: blades point +Z, pivot at the origin, and the two
# arms export as separate objects "armA" (handle on +X) and "armB" so the game can open them.
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly import *
import bpy, bmesh
from mathutils import Vector, noise
OUT = sys.argv[sys.argv.index("--") + 1]

def mesh_obj(name, bm, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); col().objects.link(o)
    for m in mats: me.materials.append(bpy.data.materials[m])
    return o

def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def build_rock():
    reset()
    mat("stoneL", "#aab4c8", 0.85); mat("stoneM", "#7f8aa3", 0.9); mat("stoneD", "#56607a", 0.95)
    mat("eye", "#ffffff", 0.4, 0, "#ffffff", 0.5); mat("ink", "#1b1630", 0.6)
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.3)
    for v in bm.verts:
        n = noise.noise(v.co * 3.1 + Vector((4.2, 1.3, 7.7))) * 0.55 + noise.noise(v.co * 7.0) * 0.2
        v.co *= 1 + n * 0.42
        v.co.z *= 0.86; v.co.y *= 0.92
        if v.co.z < -0.2: v.co.z = -0.2 + (v.co.z + 0.2) * 0.35   # sits on a flat-ish base
    rock = mesh_obj("rock", bm, ["stoneL", "stoneM", "stoneD"])
    d = rock.modifiers.new("d", "DECIMATE"); d.ratio = 0.2
    apply_mods(rock)
    random.seed(5)
    for p in rock.data.polygons:
        p.use_smooth = False
        up = p.normal.z + p.normal.y * -0.35 + random.uniform(-0.25, 0.25)
        p.material_index = 0 if up > 0.45 else (1 if up > -0.25 else 2)
    # the face: glaring eyes under heavy slanted brows, and a grim mouth
    def front(x, z):  # the rock's surface on the camera side at (x, z)
        hit, loc, nrm, _ = rock.ray_cast(Vector((x, -2, z)), Vector((0, 1, 0)))
        return loc.y if hit else -0.25
    parts = [rock]
    for sx in (-1, 1):
        y = front(sx * 0.1, 0.03)
        parts.append(sphere(f"eye{sx}", 0.058, (sx * 0.1, y + 0.012, 0.03), "eye", scale=(1, 0.45, 1.1)))
        parts.append(sphere(f"pupil{sx}", 0.027, (sx * 0.088, y - 0.012, 0.022), "ink", scale=(1, 0.5, 1)))
        parts.append(box(f"brow{sx}", (0.15, 0.05, 0.042), (sx * 0.105, y - 0.016, 0.092), "ink", rot=(0, -sx * 0.5, 0), bevel=0.008))
    parts.append(box("mouth", (0.13, 0.03, 0.022), (0, front(0, -0.1) - 0.004, -0.1), "ink", rot=(0, 0, 0), bevel=0.006))
    for sx in (-1, 1):
        parts.append(box(f"mouthc{sx}", (0.045, 0.03, 0.022), (sx * 0.075, front(sx * 0.075, -0.115) - 0.004, -0.112), "ink", rot=(0, -sx * 0.6, 0), bevel=0.006))
    for o in parts[1:]:
        if o.name.startswith(("eye", "pupil")):
            for q in o.data.polygons: q.use_smooth = True
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = rock; bpy.ops.object.join()
    return [rock]

def poly(bm, pts, y, mi):
    f = bm.faces.new([bm.verts.new((x, y, z)) for x, z in pts]); f.material_index = mi; return f

def build_scissors():
    reset()
    mat("steel", "#c9d3e6", 0.28, 0.55); mat("edge", "#f6f9ff", 0.18, 0.4, "#dfe9ff", 0.35)
    mat("grip", "#f43f5e", 0.35, 0.0, "#f43f5e", 0.18); mat("gripD", "#b81d3c", 0.45); mat("gold", "#fbbf24", 0.3, 0.7, "#fbbf24", 0.2)
    arms = []
    for name, sx, y in (("armA", 1, -0.014), ("armB", -1, 0.014)):
        bm = bmesh.new()
        blade = [(0.014, -0.06), (0.014, 0.12), (0.006, 0.58), (-0.03, 0.44), (-0.062, 0.24), (-0.07, 0.06), (-0.05, -0.04)]
        shank = [(-0.05, -0.02), (0.014, -0.06), (0.13, -0.17), (0.085, -0.2)]
        for pts in (blade, shank): poly(bm, [(sx * x, z) for x, z in (pts if sx > 0 else pts[::-1])], y, 0)
        o = mesh_obj(name, bm, ["steel", "edge"])
        s = o.modifiers.new("s", "SOLIDIFY"); s.thickness = 0.024; s.offset = 0
        b = o.modifiers.new("b", "BEVEL"); b.width = 0.006; b.segments = 2
        apply_mods(o)
        # the ground cutting edge: a bright bevel strip along the inner side, on the outer face
        bm = bmesh.new()
        strip = [(0.014, -0.02), (0.014, 0.12), (0.006, 0.58), (-0.012, 0.45), (-0.012, 0.0)]
        yf = y + (-0.0135 if sx > 0 else 0.0135)
        poly(bm, [(sx * x, z) for x, z in (strip if sx > 0 else strip[::-1])], yf, 0)
        if sx < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)
        e = mesh_obj(name + "_edge", bm, ["edge"])
        # loop handle: a fat oval ring with a darker inner band
        bpy.ops.mesh.primitive_torus_add(major_radius=0.092, minor_radius=0.034, major_segments=28, minor_segments=10, location=(sx * 0.15, y, -0.29), rotation=(math.pi / 2, 0, 0))
        ring = bpy.context.object; ring.scale = (1, 1.25, 1); ring.rotation_euler = (math.pi / 2, sx * 0.35, 0); ring.data.materials.append(bpy.data.materials["grip"])
        bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.014, major_segments=24, minor_segments=6, location=(sx * 0.15, y, -0.29), rotation=(math.pi / 2, 0, 0))
        inner = bpy.context.object; inner.scale = (1, 1.25, 1.3); inner.rotation_euler = (math.pi / 2, sx * 0.35, 0); inner.data.materials.append(bpy.data.materials["gripD"])
        for p in list(ring.data.polygons) + list(inner.data.polygons): p.use_smooth = True
        bpy.ops.object.select_all(action="DESELECT")
        for q in (o, e, ring, inner): q.select_set(True)
        bpy.context.view_layer.objects.active = o; bpy.ops.object.join()
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        arms.append(o)
    pin = cyl("pin", 0.03, 0.074, (0, 0, 0), "gold", rot=(math.pi / 2, 0, 0), seg=14)
    slot = box("slot", (0.04, 0.008, 0.008), (0, -0.038, 0), "gripD", rot=(0, 0.6, 0))
    bpy.ops.object.select_all(action="DESELECT"); pin.select_set(True); slot.select_set(True)
    bpy.context.view_layer.objects.active = pin; bpy.ops.object.join()
    return arms + [pin]

def shoot(name, target_z, dist, open_arms=None):
    sc = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 520, 520
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.12, 0.4, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); col().objects.link(sun); sun.data.energy = 4; sun.rotation_euler = (math.radians(60), 0, math.radians(-25))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); col().objects.link(cam); sc.camera = cam; cam.data.lens = 60
    cam.location = (dist * 0.25, -dist, target_z + dist * 0.2); d = Vector((0, 0, target_z)) - Vector(cam.location); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if open_arms:
        open_arms[0].rotation_euler.y = -0.3; open_arms[1].rotation_euler.y = 0.3
    sc.render.filepath = f"{OUT}/{name}.png"; bpy.ops.render.render(write_still=True)
    if open_arms:
        open_arms[0].rotation_euler.y = 0; open_arms[1].rotation_euler.y = 0
    for o in (sun, cam): bpy.data.objects.remove(o)

def export(name):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb", export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_normals=True, export_texcoords=False)

r = build_rock(); print("TRIS rock", sum(len(p.vertices) - 2 for p in r[0].data.polygons)); export("rock"); shoot("rock", 0.02, 1.5)
s = build_scissors(); print("TRIS scissors", sum(len(p.vertices) - 2 for o in s for p in o.data.polygons)); export("scissors"); shoot("scissors", 0.1, 2.4, s)
