# The five pet stages, built and rendered in Blender from the terminal:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python frontend/tools/blender/build_pets.py -- <out_dir> [stage ...]
#
# Each pet is real geometry with a real jelly material (light passes through the
# body and is tinted on the way), lit by three lamps, rendered with no
# background and a soft shadow under it. Nothing is drawn by hand, so every
# stage shares one look and a new stage is a few lines.
#
#   egg      a speckled pearl egg
#   baby     a small green slime
#   teen     a taller purple slime with stubby arms
#   crystal  a faceted slime of cyan glass with a lit core, and shards at its foot
#   king     a gold slime with a crown, a cape collar, and three small subjects

import bpy, bmesh, math, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/pets"
ONLY = set(argv[1:])
random.seed(7)

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
    s.cycles.samples = 160; s.cycles.use_denoising = True
    s.cycles.max_bounces = 14; s.cycles.transmission_bounces = 12; s.cycles.volume_bounces = 2
    s.render.film_transparent = True
    s.render.resolution_x = s.render.resolution_y = 1024
    s.render.image_settings.file_format = "PNG"; s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"; s.view_settings.exposure = -0.45
    try: s.view_settings.look = "Medium High Contrast"
    except Exception: pass
    # a soft studio: something for the jelly to reflect, without lighting the scene flat
    w = bpy.data.worlds.new("w"); s.world = w; w.use_nodes = True
    nt = w.node_tree; bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    grad = nt.nodes.new("ShaderNodeTexGradient"); ramp = nt.nodes.new("ShaderNodeValToRGB"); co = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, math.radians(90), 0)
    nt.links.new(co.outputs["Generated"], mp.inputs["Vector"]); nt.links.new(mp.outputs["Vector"], grad.inputs["Vector"]); nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = (0.10, 0.07, 0.22, 1); ramp.color_ramp.elements[1].color = (1.0, 0.96, 1.0, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.85
    return s

def lamp(name, loc, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.9)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o

def stage_lights(rim=(0.75, 0.55, 1.0)):
    lamp("key", (-3.4, -4.4, 5.6), 1300, 5.5)
    lamp("fill", (4.6, -3.2, 2.4), 360, 6.0, (0.9, 0.95, 1.0))
    lamp("rim", (1.8, 4.6, 3.6), 1500, 2.4, rim)
    lamp("top", (0, 0.4, 6.0), 380, 2.0)

def camera(height=1.05, dist=7.4, lens=62):
    c = bpy.data.cameras.new("cam"); c.lens = lens
    o = bpy.data.objects.new("cam", c); bpy.context.scene.collection.objects.link(o)
    o.location = (0, -dist, height + 0.9)
    o.rotation_euler = (Vector((0, 0, height)) - Vector(o.location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = o

def floor():
    return None  # the pet stands on nothing: its shadow is painted in afterwards (finish_pets.py), soft and small

def bsdf(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")

def put(node, **kw):
    for k, v in kw.items():
        name = k.replace("_", " ")
        if name in node.inputs: node.inputs[name].default_value = v

def jelly(name, color, deep, density=1.25, rough=0.06, glow=None):
    """Clear gel: light goes in, is tinted by how far it travels, and comes out. That depth is what reads as slime."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = bsdf(m)
    put(b, Base_Color=(*color, 1), Roughness=rough, IOR=1.38, Transmission_Weight=1.0, Coat_Weight=1.0, Coat_Roughness=0.03, Specular_IOR_Level=0.6)
    if glow: put(b, Emission_Color=(*glow, 1), Emission_Strength=0.35)
    nt = m.node_tree; out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    put(vol, Color=(*deep, 1), Density=density, Anisotropy=0.5, Absorption_Color=(*deep, 1))
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    return m

def solid(name, color, rough=0.3, metal=0.0, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = bsdf(m); put(b, Base_Color=(*color, 1), Roughness=rough, Metallic=metal, Coat_Weight=coat)
    if emit: put(b, Emission_Color=(*emit, 1), Emission_Strength=strength)
    return m

def blob(elements, res=0.045, cut=0.0, name="body"):
    """Metaballs fused into one skin, then cut flat where it sits on the floor."""
    mb = bpy.data.metaballs.new(name + "_mb"); mb.resolution = res; mb.render_resolution = res; mb.threshold = 0.6
    o = bpy.data.objects.new(name + "_mb", mb); bpy.context.scene.collection.objects.link(o)
    for (x, y, z, r, sx, sy, sz) in elements:
        e = mb.elements.new(type="ELLIPSOID"); e.co = (x, y, z); e.radius = r; e.size_x, e.size_y, e.size_z = sx, sy, sz; e.stiffness = 2.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    bpy.data.objects.remove(o)
    body = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(body)
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res_ = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, cut), plane_no=(0, 0, -1), clear_outer=True)
    edges = [e for e in res_["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if edges: bmesh.ops.holes_fill(bm, edges=edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    body.location.z = -cut
    sm = body.modifiers.new("smooth", "CORRECTIVE_SMOOTH"); sm.iterations = 12; sm.factor = 0.6
    return body

def ball(loc, r, mat, scale=(1, 1, 1), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    o = bpy.context.object; o.scale = scale; bpy.ops.object.shade_smooth(); o.data.materials.append(mat); return o

def face(y, z, gap, eye_r, look=(0.0, 0.0), happy=True, cheek=(1.0, 0.45, 0.6)):
    """Two glossy eyes with a catch-light each, a small mouth, and a blush. `y` is how far forward the face sits."""
    black = solid("eye", (0.004, 0.003, 0.012), rough=0.04, coat=1.0)
    white = solid("glint", (1, 1, 1), emit=(1, 1, 1), strength=6.0)
    for sx in (-1, 1):
        ball((sx * gap, y, z), eye_r, black, (1, 0.62, 1.12))
        ball((sx * gap - eye_r * 0.30 + look[0], y - eye_r * 0.52, z + eye_r * 0.42 + look[1]), eye_r * 0.30, white, (1, 0.5, 1))
        ball((sx * gap + eye_r * 0.30 + look[0], y - eye_r * 0.52, z - eye_r * 0.30 + look[1]), eye_r * 0.13, white, (1, 0.5, 1))
        ball((sx * (gap + eye_r * 1.35), y - 0.01, z - eye_r * 1.0), eye_r * 0.6, solid("blush", (cheek[0] * 0.9, cheek[1] * 0.55, cheek[2] * 0.6), rough=0.85, emit=cheek, strength=0.1), (1, 0.14, 0.55))
    mouth = solid("mouth", (0.16, 0.01, 0.04), rough=0.5)
    if True:
        bpy.ops.mesh.primitive_torus_add(major_radius=eye_r * (0.62 if happy else 0.5), minor_radius=eye_r * (0.1 if happy else 0.075), location=(0, y - 0.03, z - eye_r * 0.62), rotation=(math.radians(90), 0, 0))
        o = bpy.context.object
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > -eye_r * 0.12], context="VERTS")  # the ring lies flat before it is stood up: its far half is the top of the smile
        bm.to_mesh(o.data); bm.free()
        o.scale = (1, 1, 0.75); bpy.ops.object.shade_smooth(); o.data.materials.append(mouth)

def bubbles(n, r, zmin, zmax, mat):
    for _ in range(n):
        a = random.uniform(0, math.tau); d = random.uniform(0, r)
        ball((math.cos(a) * d, math.sin(a) * d * 0.7 + 0.15, random.uniform(zmin, zmax)), random.uniform(0.03, 0.085), mat, seg=20)

def crown(z, r=0.42, tilt=0.0, x=0.0, gems=True):
    gold = solid("gold", (1.0, 0.72, 0.16), rough=0.18, metal=1.0)
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=r * 0.42, location=(x, 0.05, z), vertices=48)
    band = bpy.context.object; bpy.ops.object.shade_smooth(); band.data.materials.append(gold); band.rotation_euler = (0, tilt, 0)
    parts = [band]
    for i in range(5):
        a = i / 5 * math.tau + 0.3
        bpy.ops.mesh.primitive_cone_add(radius1=r * 0.3, depth=r * 0.78, location=(x + math.cos(a) * r * 0.86, 0.05 + math.sin(a) * r * 0.86, z + r * 0.52), vertices=24)
        c = bpy.context.object; bpy.ops.object.shade_smooth(); c.data.materials.append(gold); parts.append(c)
        parts.append(ball((x + math.cos(a) * r * 0.86, 0.05 + math.sin(a) * r * 0.86, z + r * 0.95), r * 0.11, gold, seg=20))
    if gems:
        ruby = solid("ruby", (0.85, 0.03, 0.10), rough=0.05, emit=(1.0, 0.1, 0.15), strength=0.8, coat=1.0)
        for i in range(5):
            a = i / 5 * math.tau + 0.3 + math.tau / 10
            parts.append(ball((x + math.cos(a) * r * 1.0, 0.05 + math.sin(a) * r * 1.0, z), r * 0.13, ruby, seg=20))
    if tilt:
        for p in parts[1:]:
            v = Vector(p.location) - Vector((x, 0.05, z)); v.rotate(band.rotation_euler); p.location = Vector((x, 0.05, z)) + v; p.rotation_euler = (0, tilt, 0)
    return parts

def render(name):
    bpy.context.scene.render.filepath = f"{OUT}/{name}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", name)

# ── the stages ────────────────────────────────────────────────────────────────
def egg():
    reset(); stage_lights((1.0, 0.8, 0.95)); camera(1.05, 7.6); floor()
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(0, 0, 1.18), segments=96, ring_count=48)
    o = bpy.context.object
    for v in o.data.vertices:                      # narrower at the top, as an egg is
        t = (v.co.z + 1) / 2; k = 1.0 - 0.26 * t ** 1.6
        v.co.x *= k; v.co.y *= k; v.co.z *= 1.22
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new("shell"); m.use_nodes = True; nt = m.node_tree; b = bsdf(m)
    put(b, Roughness=0.28, Coat_Weight=0.7, Coat_Roughness=0.1)
    if "Subsurface Radius" in b.inputs: b.inputs["Subsurface Radius"].default_value = (0.5, 0.35, 0.6)
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 8.5
    if "Randomness" in vor.inputs: vor.inputs["Randomness"].default_value = 1.0
    spots = nt.nodes.new("ShaderNodeValToRGB"); spots.color_ramp.elements[0].position = 0.2; spots.color_ramp.elements[1].position = 0.27
    spots.color_ramp.elements[0].color = (1, 1, 1, 1); spots.color_ramp.elements[1].color = (0, 0, 0, 1)
    pick = nt.nodes.new("ShaderNodeValToRGB"); pick.color_ramp.elements[0].color = (0.42, 0.18, 0.92, 1); pick.color_ramp.elements[1].color = (1.0, 0.55, 0.08, 1)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    nt.links.new(vor.outputs["Distance"], spots.inputs["Fac"]); nt.links.new(vor.outputs["Color"], pick.inputs["Fac"])
    nt.links.new(spots.outputs["Color"], mix.inputs[0]); mix.inputs[6].default_value = (0.80, 0.76, 0.90, 1); nt.links.new(pick.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    o.data.materials.append(m)
    render("stage-1-egg")

def baby():
    reset(); stage_lights((0.7, 1.0, 0.6)); camera(0.92, 5.9); floor()
    drips = [(math.cos(a) * 1.08, math.sin(a) * 0.98, 0.14, 0.34 + 0.07 * math.sin(a * 3), 1.25, 1.2, 0.55) for a in [i / 6 * math.tau + 0.5 for i in range(6)]]
    body = blob([(0, 0, 1.0, 1.62, 1.0, 0.95, 0.95), (0, 0, 0.36, 1.5, 1.1, 1.0, 0.5)] + drips)
    body.data.materials.append(jelly("green", (0.42, 1.0, 0.24), (0.06, 0.62, 0.03), density=2.1))
    bubbles(8, 0.55, 0.45, 1.45, solid("bub", (0.85, 1.0, 0.75), rough=0.1, emit=(0.8, 1.0, 0.6), strength=0.6))
    face(-0.98, 1.08, 0.40, 0.235)
    render("stage-2-baby")

def teen():
    reset(); stage_lights((0.9, 0.5, 1.0)); camera(1.2, 8.2); floor()
    drips = [(math.cos(a) * 0.95, math.sin(a) * 0.85, 0.15, 0.4 + 0.1 * math.sin(a * 2 + 1), 1.3, 1.2, 0.6) for a in [i / 10 * math.tau for i in range(10)]]
    body = blob([(0, 0, 1.55, 1.3, 0.98, 0.9, 1.12), (0, 0, 0.75, 1.5, 1.0, 0.92, 0.9), (0, 0, 0.28, 1.45, 1.2, 1.05, 0.44),
                 (-1.06, -0.05, 1.0, 0.62, 0.72, 0.8, 1.25), (1.06, -0.05, 1.0, 0.62, 0.72, 0.8, 1.25)] + drips)
    body.data.materials.append(jelly("purple", (0.62, 0.30, 1.0), (0.30, 0.04, 0.82), density=2.6))
    bubbles(12, 0.6, 0.4, 2.0, solid("bub", (0.95, 0.85, 1.0), rough=0.1, emit=(0.9, 0.7, 1.0), strength=0.7))
    face(-0.84, 1.62, 0.37, 0.225, happy=False)
    crown(2.34, 0.34, tilt=0.24, x=0.16, gems=False)
    render("stage-3-teen")

def crystal():
    reset(); stage_lights((0.4, 0.9, 1.0)); camera(1.25, 8.4); floor()
    drips = [(math.cos(a) * 0.95, math.sin(a) * 0.85, 0.16, 0.42, 1.3, 1.2, 0.6) for a in [i / 8 * math.tau for i in range(8)]]
    body = blob([(0, 0, 1.6, 1.3, 0.98, 0.9, 1.14), (0, 0, 0.75, 1.5, 1.0, 0.92, 0.92), (0, 0, 0.28, 1.45, 1.2, 1.05, 0.44),
                 (-1.05, -0.05, 1.0, 0.6, 0.72, 0.8, 1.25), (1.05, -0.05, 1.0, 0.6, 0.72, 0.8, 1.25)] + drips, res=0.07)
    # cut the skin into facets: a gem, not a blob
    body.modifiers.clear()
    dec = body.modifiers.new("facet", "DECIMATE"); dec.ratio = 0.022
    for p in body.data.polygons: p.use_smooth = False
    gem = jelly("gem", (0.40, 0.80, 1.0), (0.02, 0.36, 0.92), density=1.5, rough=0.03)
    put(bsdf(gem), IOR=1.62)
    body.data.materials.append(gem)
    ball((0, 0.2, 1.15), 0.34, solid("core", (1, 1, 1), emit=(0.75, 0.5, 1.0), strength=9.0), seg=24)
    shard = jelly("shard", (0.70, 0.50, 1.0), (0.36, 0.08, 0.95), density=3.0, rough=0.03); put(bsdf(shard), IOR=1.6)
    for i, (x, y, h, rot) in enumerate([(-1.55, 0.35, 0.62, 0.28), (1.6, 0.3, 0.7, -0.26), (-1.25, -0.7, 0.4, 0.2), (1.3, -0.68, 0.44, -0.22), (-1.85, -0.25, 0.34, 0.42), (1.9, -0.28, 0.32, -0.42)]):
        bpy.ops.mesh.primitive_cone_add(radius1=h * 0.42, radius2=0.0, depth=h * 1.9, location=(x, y, h * 0.72), vertices=6, rotation=(0, rot, i))
        bpy.context.object.data.materials.append(shard)
    face(-0.9, 1.66, 0.37, 0.225, happy=False, cheek=(1.0, 0.55, 0.85))
    render("stage-4-crystal")

def king():
    reset(); stage_lights((1.0, 0.75, 0.35)); camera(1.3, 8.6); floor()
    drips = [(math.cos(a) * 1.05, math.sin(a) * 0.95, 0.17, 0.45 + 0.1 * math.sin(a * 2), 1.3, 1.2, 0.6) for a in [i / 11 * math.tau for i in range(11)]]
    body = blob([(0, 0, 1.7, 1.42, 1.0, 0.92, 1.12), (0, 0, 0.8, 1.68, 1.02, 0.94, 0.92), (0, 0, 0.3, 1.62, 1.22, 1.06, 0.44),
                 (-1.2, -0.05, 1.05, 0.68, 0.72, 0.8, 1.25), (1.2, -0.05, 1.05, 0.68, 0.72, 0.8, 1.25)] + drips)
    body.data.materials.append(jelly("gold", (1.0, 0.64, 0.10), (0.92, 0.30, 0.0), density=2.0, glow=(1.0, 0.5, 0.05)))
    bubbles(14, 0.7, 0.4, 2.2, solid("bub", (1.0, 0.95, 0.7), rough=0.1, emit=(1.0, 0.85, 0.4), strength=1.0))
    face(-0.94, 1.78, 0.40, 0.24)
    crown(2.50, 0.66)
    # three small subjects
    for (x, y, col, deep) in [(-1.72, -0.75, (0.42, 1.0, 0.24), (0.06, 0.62, 0.03)), (1.72, -0.7, (0.62, 0.30, 1.0), (0.30, 0.04, 0.82)), (-0.95, -1.4, (0.35, 0.75, 1.0), (0.03, 0.32, 0.9))]:
        s = blob([(x, y, 0.44, 0.7, 1.0, 0.92, 0.88), (x, y, 0.15, 0.72, 1.2, 1.05, 0.46)], res=0.03, name="mini")
        s.data.materials.append(jelly("mini", col, deep, density=1.6))
        blk = solid("e", (0.012, 0.01, 0.03), rough=0.03, coat=1.0); wh = solid("g", (1, 1, 1), emit=(1, 1, 1), strength=6.0)
        for sx in (-1, 1):
            ball((x + sx * 0.17, y - 0.42, 0.5), 0.1, blk, (1, 0.6, 1.1), seg=20); ball((x + sx * 0.17 - 0.025, y - 0.49, 0.54), 0.032, wh, seg=12)
    render("stage-5-king")

for name, fn in [("egg", egg), ("baby", baby), ("teen", teen), ("crystal", crystal), ("king", king)]:
    if not ONLY or name in ONLY: fn()
