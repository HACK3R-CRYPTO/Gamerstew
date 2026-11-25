# Pet art

The five pet stages a player sees on their profile, in the header and in notifications: egg, baby slime, teen slime, crystal slime and king slime. Redone on 2026-11-26.

## What changed

The old pictures were flat illustrated stickers. Two of them had a dark fringe around the edge where the background had been cut away, and the five did not share one style.

The new ones are real 3D models rendered in Blender:

- Each slime is one fused body with a jelly material. Light enters the body, is tinted by how far it travels, and leaves, so thick parts are deeper in colour than thin parts. That depth is what reads as slime.
- Eyes are glossy spheres set into the body with a catch-light each. The smile is a half ring.
- The crystal slime's skin is cut into facets and it has a lit core. The king has a metal crown with gems and three small subjects.
- All five use the same lamps, camera style and shadow, so they read as one family.

## How to rebuild them

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python frontend/tools/blender/build_pets.py -- /tmp/pets
python3 frontend/tools/blender/finish_pets.py /tmp/pets frontend/public/pets
```

Add a stage name after the folder (`baby`, `king`) to render only that one. Each render takes about half a minute.

The first step renders each pet at 1024 pixels with no background. The second trims it to the pet, centres it on a 640 pixel square and paints a small soft shadow under it. (A real shadow plane in the render greyed the whole floor, so the shadow is added afterwards.)

## Changing a pet

Each stage is one short function in `build_pets.py`. A body is a list of soft balls that fuse into one skin: position, radius, and stretch on each axis. `jelly(name, colour, deep colour, density)` sets the material: a higher density is a deeper, less see-through gel.

## Where they are used

`frontend/lib/pets.ts` maps a player's level to a stage and a file in `frontend/public/pets/`. File names did not change, so nothing else had to.
