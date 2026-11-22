# 3D asset credits

## Vehicles
- Taxi (public/world/models/taxi-meshy.glb): 3D model reconstructed with Meshy
  (meshy-6, image-to-3D, PBR) from a generated yellow-saloon reference
  (GPT Image 2); textures resized to 1024.
- Taxi, legacy/unused (public/world/models/taxi-model.glb): "Taxi" by Poly by
  Google — CC-BY 3.0. Source: https://poly.pizza/m/40_vZove67z
- Keke napep (public/world/models/keke-meshy.glb): 3D model reconstructed with
  Meshy (meshy-6, image-to-3D, PBR) from a generated keke reference (GPT Image 2);
  decimated + textures resized to 1024.
- Danfo (public/world/models/danfo-meshy.glb): 3D model reconstructed with Meshy
  (meshy-6, image-to-3D, PBR) from a generated danfo reference (GPT Image 2);
  decimated + textures resized to 1024.

## Textures (generated)
- Lagos building facades, danfo/transformer/generator/taxi skins, signwriting decals,
  billboard, canopy, road: generated with Stable Studio (GPT Image 2).
- Asphalt/concrete PBR: ambientCG (CC0).

## Trees
- Palm tree (public/world/models/palm-tree.glb): "Palm tree" by Poly by Google — CC-BY 3.0.
  Source: https://poly.pizza/m/4m2Tj2QvJjo
- Leafy tree (public/world/models/leaf-tree.glb): "Tree" by Poly by Google — CC-BY 3.0.
  Source: https://poly.pizza/m/6pwiq7hSrHr

## Other low-poly models
- Kenney Car Kit (public/world/kenney): CC0.

## Characters
- Player + pedestrians (public/world/models/player.glb, public/world/models/peds/*.glb):
  Mixamo characters + Walk/Idle/Run animations (Adobe Mixamo, royalty-free). Textures
  resized to 512. Pedestrians share one Walk/Idle clip pair, bound to each character by
  rewriting the Mixamo bone-prefix number to the character's own skeleton.

## Sound effects
- "Comot for road" shout (public/world/audio/comot-for-road.mp3): comedy sound effect
  downloaded from https://innochris.com/comot-for-road-comedy-sound-effect/ (file hosted at
  realmoneystudios.com). Trimmed, mono, loudness-normalised. NO LICENCE IS STATED on the
  source page: confirm usage rights (or replace with our own recording) before a public
  or commercial release.

## Crowd animations (Street Strike)

`models/anim/cheer-happy.glb`, `cheer-excited.glb`, `cheer-rally.glb`, `clap.glb`, `clap-standing.glb`: Mixamo (Adobe) clips, converted from FBX with fbx2gltf.
`models/anim/boo-rejected.glb`, `boo-badshot.glb`, `sad-idle.glb` and characters `peds/ch06.glb`, `ch21.glb`, `ch22.glb`, `ch46.glb`, `prisoner.glb`: Mixamo (Adobe), converted with fbx2gltf and reduced with glTF-Transform.
`models/anim/idle-standard.glb`, `idle-look.glb`, `idle-wait.glb`, `idle-heavy.glb`, `idle-heavy2.glb` and character `peds/ch20.glb`: Mixamo (Adobe).

## Street Strike crowd sound

- `public/bowling/audio/crowd-cheer.mp3`, `crowd-yeah.mp3`: cut from "Clapping hurray" by starlite, public domain, via Wikimedia Commons.
- `public/bowling/audio/crowd-clap.mp3`: cut from "applause-2" by Sandermotions, CC0, via Wikimedia Commons.
- `public/bowling/audio/glass-1..6.mp3`: cut from "Binging Glass" by hugh, public domain, via Wikimedia Commons.
- `public/bowling/audio/night.mp3`: cut from "Country night noise", public domain, via Wikimedia Commons.
