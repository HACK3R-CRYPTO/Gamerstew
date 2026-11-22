# Shared helpers for the scripted low-poly vehicles. Blender axes: X across, Y along (front = -Y), Z up. Metres.
import bpy, bmesh, math, random
from mathutils import Vector

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene.collection

def hexc(h):
    h = h.lstrip("#"); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

M = {}
def mat(name, hexcol, rough=0.6, metal=0.0, emit=None, es=1.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*hexc(hexcol), 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*hexc(emit), 1); b.inputs["Emission Strength"].default_value = es
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = "BLENDED"
        except Exception: m.blend_method = "BLEND"
    M[name] = m; return m

def base_materials():
    mat("stripe", "#15131b", 0.6); mat("trim", "#2b2935", 0.7); mat("chrome", "#c9c4d6", 0.3, 0.6)
    mat("tyre", "#17151d", 0.9); mat("rim", "#d8d3e2", 0.4, 0.4); mat("glass", "#9fc4e8", 0.1, 0, alpha=0.3)
    mat("lamp", "#fff3cf", 0.3, 0, "#ffe9a8", 2.0); mat("tail", "#ff3b3b", 0.4, 0, "#ff1e1e", 1.5); mat("amber", "#ff9d1c", 0.4, 0, "#ff8a00", 1.0)
    mat("seat", "#3a2f4a", 0.9); mat("pants", "#23203a", 0.9); mat("hair", "#16110f", 0.9)
    for n, c in zip("ABC", ("#6b4226", "#8a5a3a", "#4a2d1a")): mat("skin" + n, c, 0.8)
    for n, c in zip("ABCDEF", ("#e11d48", "#2563eb", "#22c55e", "#f4f1ea", "#7c3aed", "#f97316")): mat("shirt" + n, c, 0.85)

def col(): return bpy.context.scene.collection
def obj(name, mesh, material=None, parent=None):
    o = bpy.data.objects.new(name, mesh); col().objects.link(o)
    if material: mesh.materials.append(M[material])
    if parent: o.parent = parent
    return o
def empty(name, loc=(0, 0, 0), rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, None); col().objects.link(o); o.location = loc; o.rotation_euler = rot; return o
def box(name, size, loc, material, parent=None, rot=(0, 0, 0), bevel=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
    bm.to_mesh(me); bm.free(); o = obj(name, me, material, parent); o.location = loc; o.rotation_euler = rot; return o
def cyl(name, r, depth, loc, material, parent=None, rot=(0, math.pi / 2, 0), seg=16, r2=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    bm.to_mesh(me); bm.free(); o = obj(name, me, material, parent); o.location = loc; o.rotation_euler = rot; return o
def sphere(name, r, loc, material, parent=None, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts); bm.to_mesh(me); bm.free()
    o = obj(name, me, material, parent); o.location = loc; return o

def wheel(name, x, y, r, w, side=None, seg=16, spokes=5):
    """A wheel whose spin axis is its local Z (so the game spins it with rotateZ). side: +1/-1 outer face, None = both."""
    wo = cyl(name, r, w, (x, y, r), "tyre", seg=seg)
    for s in ((side,) if side else (-1, 1)):
        a = cyl(f"{name}_rim{s}", r * 0.62, 0.02, (0, 0, s * (w / 2 + 0.004)), "rim", wo, rot=(0, 0, 0), seg=12)
        cyl(f"{name}_hub{s}", r * 0.2, 0.05, (0, 0, s * (w / 2 + 0.02)), "chrome", wo, rot=(0, 0, 0), seg=8)
        for k in range(spokes):
            an = k * math.tau / spokes
            box(f"{name}_lug{s}{k}", (0.045, 0.045, 0.02), (math.cos(an) * r * 0.4, math.sin(an) * r * 0.4, s * (w / 2 + 0.012)), "trim", wo)
    return wo

SHIRTS = ["shirtA", "shirtB", "shirtC", "shirtD", "shirtE", "shirtF"]; SKINS = ["skinA", "skinB", "skinC"]
def person(name, x, y, seat_z, pose="sit", lean=0.0, helmet=None, rng=random):
    """Stylised seated figure. pose: sit | drive (arms forward) | ride (astride, arms to bars)."""
    root = empty(name, (x, y, seat_z))
    sh = rng.choice(SHIRTS); sk = rng.choice(SKINS)
    box(name + "_t", (0.36, 0.22, 0.46), (0, 0.04 - lean * 0.2, 0.25), sh, root, rot=(lean, 0, 0), bevel=0.05)
    hy = 0.02 - lean * 0.5
    sphere(name + "_h", 0.125, (0, hy, 0.62), sk, root, scale=(0.95, 1, 1.08))
    if helmet:
        sphere(name + "_helm", 0.15, (0, hy + 0.01, 0.65), helmet, root, scale=(1, 1.05, 0.92))
    else:
        k = rng.random()
        if k < 0.45: sphere(name + "_hair", 0.128, (0, hy + 0.025, 0.66), "hair", root, scale=(1, 1, 0.8))
        elif k < 0.7: box(name + "_cap", (0.24, 0.3, 0.07), (0, hy - 0.05, 0.725), rng.choice(SHIRTS), root, bevel=0.02)
        else: sphere(name + "_gele", 0.17, (0, hy + 0.02, 0.7), rng.choice(SHIRTS), root, scale=(1.1, 1, 0.7))
    spread = 0.17 if pose == "ride" else 0.1
    for s in (-1, 1):
        box(name + f"_leg{s}", (0.13, 0.4, 0.13), (s * spread, -0.2, 0.03), "pants", root, bevel=0.03)
        box(name + f"_shin{s}", (0.11, 0.11, 0.38), (s * spread, -0.38 if pose != "ride" else -0.3, -0.17), "pants", root, bevel=0.03)
        if pose in ("drive", "ride"):
            box(name + f"_arm{s}", (0.09, 0.4, 0.09), (s * 0.2, -0.24 - lean * 0.2, 0.34), sk, root, rot=(math.radians(-16), 0, 0), bevel=0.03)
        else:
            box(name + f"_arm{s}", (0.09, 0.1, 0.32), (s * 0.225, 0.02, 0.26), sh, root, bevel=0.03)
    return root

def join(root):
    """Join root's children into root (mesh root) or into one mesh that takes the empty root's name."""
    kids = [o for o in bpy.data.objects if o.parent == root]
    bpy.ops.object.select_all(action="DESELECT")
    if root.type == "MESH":
        for o in kids + [root]: o.select_set(True)
        bpy.context.view_layer.objects.active = root; bpy.ops.object.join(); return root
    for o in kids: o.select_set(True)
    bpy.context.view_layer.objects.active = kids[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM"); bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active; nm = root.name; bpy.data.objects.remove(root); j.name = nm; return j

def finish(out, roots, shots, target_z=0.8):
    for r in roots: join(r)
    for o in bpy.data.objects:
        if o.type == "MESH":
            for p in o.data.polygons: p.use_smooth = False
    print("TRIS", sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH"), sorted(o.name for o in bpy.data.objects))
    bpy.ops.export_scene.gltf(filepath=out + ".glb", export_format="GLB", export_apply=True, export_yup=True, export_materials="EXPORT", export_normals=True, export_texcoords=False)
    sc = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 800, 520
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.42, 0.6, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); col().objects.link(sun); sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
    gm = bpy.data.meshes.new("g"); bmg = bmesh.new(); bmesh.ops.create_grid(bmg, size=30); bmg.to_mesh(gm); g = obj("ground", gm); gm.materials.append(mat("gr", "#3d3a4a", 0.9))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); col().objects.link(cam); sc.camera = cam; cam.data.lens = 50
    for name, pos in shots:
        cam.location = pos; d = Vector((0, 0, target_z)) - Vector(pos); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{out}-{name}.png"; bpy.ops.render.render(write_still=True)
