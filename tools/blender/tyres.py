# Street Strike's three tyres, scripted. Each is a different object, not a recolour:
#   keke  : small three-wheeler road tyre, ribbed tread, painted yellow dish rim
#   danfo : big wide bus tyre, chunky block tread, white-wall, six-stud steel rim
#   okada : tall narrow motorcycle tyre, knobbly tread, wire spokes, brake disc and sprocket
# Axle along X so the game spins it about X. Exports tyre-<kind>.glb, object "tyre".
# Paint bands use materials stripe / pink / green, which the game recolours per tyre.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lowpoly import *
import bpy, bmesh
from mathutils import Vector
OUT = sys.argv[sys.argv.index("--") + 1]
KINDS = {"keke": (0.23, 0.066), "danfo": (0.30, 0.108), "okada": (0.27, 0.046)}

def build(kind):
    R, W = KINDS[kind]
    reset()
    mat("rubber", "#23202d", 0.8); mat("tread", "#3b3748", 0.9); mat("wall", "#f4f1ea", 0.7)
    mat("steel", "#a8a3b5", 0.35, 0.7); mat("hole", "#0d0c12", 0.9); mat("cap", "#fbbf24", 0.35, 0.6, "#fbbf24", 0.25)
    mat("rimpaint", "#f2b705", 0.5, 0.2); mat("chrome", "#e6e3ee", 0.2, 0.9); mat("brass", "#d9a441", 0.35, 0.8)
    mat("stripe", "#fbbf24", 0.6, 0.0, "#fbbf24", 0.45); mat("pink", "#ff5fb0", 0.6, 0.0, "#ff5fb0", 0.45); mat("green", "#4ade80", 0.6, 0.0, "#4ade80", 0.45)
    kr, kw = R / 0.27, W / 0.098
    inner = 0.150 * kr if kind != "okada" else 0.19
    base = [(-0.062, 0.150), (-0.088, 0.172), (-0.098, 0.205), (-0.094, 0.238), (-0.080, 0.258), (-0.064, 0.266)]
    half = [(x * kw, (inner if i == 0 else r * kr)) for i, (x, r) in enumerate(base)]
    prof = half + [(-x, r) for x, r in reversed(half)]
    me = bpy.data.meshes.new("tyre"); bm = bmesh.new()
    vs = [bm.verts.new((x, 0, r)) for x, r in prof]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(1, 0, 0), angle=math.tau, steps=32, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    tyre = obj("tyre", me, "rubber")

    def ring(name, n, radius, size, x, material, phase=0.0, tilt=0.0):
        for k in range(n):
            a = phase + k * math.tau / n
            box(f"{name}{k}", size, (x, math.sin(a) * radius, math.cos(a) * radius), material, tyre, rot=(-a, 0, tilt))
    def disc(name, r, depth, x, material, seg=24, r2=None):
        cyl(name, r, depth, (x, 0, 0), material, tyre, seg=seg, r2=r2)
    def annulus(name, r0, r1, x, material, seg=32):
        m = bpy.data.meshes.new(name); b = bmesh.new()
        i_ = [b.verts.new((x, math.sin(i * math.tau / seg) * r0, math.cos(i * math.tau / seg) * r0)) for i in range(seg)]
        o_ = [b.verts.new((x, math.sin(i * math.tau / seg) * r1, math.cos(i * math.tau / seg) * r1)) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            b.faces.new((i_[i], i_[j], o_[j], o_[i]) if x > 0 else (i_[i], o_[i], o_[j], i_[j]))
        b.to_mesh(m); b.free(); obj(name, m, material, tyre)
    def paint(n, width):
        mats = ["stripe", "pink", "stripe", "green"]
        for q in range(n):
            a0 = q * math.tau / n
            for k in range(3):
                a = a0 + k * 0.062
                box(f"paint{q}{k}", (width, 0.032 * kr, 0.008), (0, math.sin(a) * (R + 0.013), math.cos(a) * (R + 0.013)), mats[q % 4], tyre, rot=(-a, 0, 0))

    if kind == "danfo":
        # chunky block tread in three staggered rows, heavy shoulder lugs
        for i, x in enumerate((-0.058, 0.0, 0.058)):
            ring(f"tr{i}", 20, R + 0.006, (0.05, 0.062, 0.028), x, "tread", (i % 2) * math.tau / 40, 0.22 * (1 - i))
        for s in (-1, 1):
            ring(f"sh{s}", 20, R - 0.02, (0.024, 0.06, 0.04), s * W * 0.93, "tread", math.tau / 40 if s > 0 else 0)
            annulus(f"wall{s}", R * 0.72, R * 0.83, s * (W + 0.0015), "wall")
            disc(f"dish{s}", R * 0.56, 0.02, s * W * 0.6, "steel")
            disc(f"lip{s}", R * 0.56, 0.016, s * W * 0.72, "steel", r2=R * 0.5)
            disc(f"face{s}", R * 0.4, 0.014, s * W * 0.76, "steel", seg=20)
            for k in range(6):
                a = k * math.tau / 6
                cyl(f"stud{s}{k}", 0.014, 0.03, (s * W * 0.8, math.sin(a) * R * 0.26, math.cos(a) * R * 0.26), "chrome", tyre, seg=6)
                cyl(f"vent{s}{k}", 0.022, 0.02, (s * W * 0.74, math.sin(a + 0.52) * R * 0.46, math.cos(a + 0.52) * R * 0.46), "hole", tyre, seg=8)
            disc(f"hub{s}", 0.05, 0.05, s * W * 0.82, "cap", seg=12)
        disc("barrel", R * 0.55, W * 1.3, 0, "hole")
        paint(8, W * 1.7)
    elif kind == "keke":
        # road tyre: four clean ribs running round it, no blocks
        for i, x in enumerate((-0.042, -0.014, 0.014, 0.042)):
            ring(f"rib{i}", 40, R + 0.003, (0.017, 0.04, 0.014), x, "tread")
        for s in (-1, 1):
            ring(f"sipe{s}", 30, R - 0.016, (0.012, 0.016, 0.02), s * W * 0.95, "tread")
            # painted dish rim with a chrome dome, the way keke wheels are dressed up
            disc(f"dish{s}", R * 0.6, 0.016, s * W * 0.62, "rimpaint")
            disc(f"cone{s}", R * 0.46, 0.03, s * W * 0.86, "rimpaint", r2=R * 0.2)
            for k in range(4):
                a = k * math.tau / 4 + 0.78
                cyl(f"slot{s}{k}", 0.02, 0.02, (s * W * 0.78, math.sin(a) * R * 0.42, math.cos(a) * R * 0.42), "hole", tyre, seg=8)
            disc(f"dome{s}", 0.04, 0.05, s * W * 1.0, "chrome", seg=12, r2=0.018)
        disc("barrel", R * 0.58, W * 1.2, 0, "hole")
        paint(6, W * 1.6)
    else:
        # okada: knobbly narrow tread, wire spokes you can see through, brake disc one side, sprocket the other
        ring("kn0", 30, R + 0.006, (0.022, 0.03, 0.024), 0.0, "tread")
        for s in (-1, 1):
            ring(f"kn{s}", 30, R - 0.004, (0.018, 0.028, 0.026), s * W * 0.62, "tread", math.tau / 60)
        rim_r = 0.19
        for s in (-1, 1):
            annulus(f"rim{s}", rim_r - 0.018, rim_r + 0.004, s * W * 0.96, "chrome")
        # no solid disc here: the wheel is open, so you see the spokes and the road through it
        n = 16
        for k in range(n):
            a = k * math.tau / n
            s = 1 if k % 2 else -1
            mid = (rim_r - 0.02 + 0.03) / 2
            box(f"spoke{k}", (0.009, 0.009, rim_r - 0.05), (s * 0.016, math.sin(a) * mid, math.cos(a) * mid), "chrome", tyre, rot=(-a, s * 0.16, 0))
        disc("hub", 0.036, 0.12, 0, "steel", seg=12)
        disc("brake", 0.105, 0.006, -0.05, "steel", seg=20)
        disc("brakein", 0.06, 0.008, -0.05, "hole", seg=16)
        for k in range(8):
            a = k * math.tau / 8
            cyl(f"bh{k}", 0.009, 0.01, (-0.05, math.sin(a) * 0.084, math.cos(a) * 0.084), "hole", tyre, seg=6)
        disc("sprocket", 0.085, 0.006, 0.05, "brass", seg=18)
        ring("teeth", 18, 0.088, (0.006, 0.014, 0.014), 0.05, "brass")
        paint(6, W * 1.5)

    join(tyre)
    for p in tyre.data.polygons: p.use_smooth = False
    print("TRIS", kind, sum(len(p.vertices) - 2 for p in tyre.data.polygons))
    bpy.ops.export_scene.gltf(filepath=f"{OUT}-{kind}.glb", export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_normals=True, export_texcoords=False)
    sc = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 520, 460
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.25, 0.5, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); col().objects.link(sun); sun.data.energy = 5; sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    tyre.location = (0, 0, R)
    gm = bpy.data.meshes.new("g"); bmg = bmesh.new(); bmesh.ops.create_grid(bmg, size=10); bmg.to_mesh(gm); obj("ground", gm); gm.materials.append(mat("gr", "#3d3a4a", 0.9))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); col().objects.link(cam); sc.camera = cam; cam.data.lens = 60
    cam.location = (1.05, -1.05, 0.55); d = Vector((0, 0, 0.27)) - Vector(cam.location); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{OUT}-{kind}.png"; bpy.ops.render.render(write_still=True)

for k in (sys.argv[sys.argv.index("--") + 2:] or KINDS): build(k)
