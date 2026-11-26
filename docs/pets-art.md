# Pet art

The five pet stages a player sees on their profile, in the header and in notifications: egg, baby slime, teen slime, crystal slime and king slime. Redone on 2026-11-26.

## What changed

The old pictures were flat illustrated stickers. Two of them had a dark fringe around the edge where the background had been cut away, and the five did not share one style.

The new ones are real 3D models rendered in Blender:

- Each slime is one fused body with a jelly material. Light enters the body, is tinted by how far it travels, and leaves, so thick parts are deeper in colour than thin parts. That depth is what reads as slime.
- Eyes are glossy spheres set into the body with a catch-light each. The smile is a half ring.
- The crystal slime's skin is cut into facets and it has a lit core. The king has a metal crown with gems and three small subjects.
- All five use the same lamps, camera style and shadow, so they read as one family.

## Moods

Every slime has five faces, rendered from the same model, so the body is identical in each and only the face changes.

| Face | When it shows |
|---|---|
| happy | The resting face when the player has played today |
| blink | For a moment every few seconds while happy |
| joy | A poke, a right answer, a cleared round |
| sad | The streak would break today and the player has not played. Also a wrong answer in a game |
| sleepy | No streak and no play today |

The egg has no face yet. It rocks now and then, and harder when poked.

`restingMood()` in `frontend/lib/pets.ts` decides happy, sad or sleepy from two facts the server already sends: the streak, and whether the player has played today. `moodLine()` gives the sentence that says why and what fixes it ("Your slime misses you. Play one game today to keep your 4 day streak.").

## Movement

`frontend/components/Pet.tsx` is the one component for a living pet. The faces are stacked and shown by opacity, so a blink or a reaction never flickers. Movement is CSS on the wrapper (the "Pet" block in `app/globals.css`), always from the feet up, the way a soft body moves:

- happy: slow breathing
- joy: a hop with squash and stretch, and sparks
- sad: sunk a little, a slow sway
- sleepy: deep slow breathing, and floating Zs
- a poke: one hard squish, then joy for a moment

Players who have asked their device for less motion get the faces without the movement.

Where it is used: the profile (large, can be poked, with the mood line), the header avatar (the player's own slime and how it feels today, on every page), and the companions in Simon Memory and Rhythm Rush, whose face now follows the play. Other screens still show the resting picture.

## How to rebuild them

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python frontend/tools/blender/build_pets.py -- /tmp/pets moods=happy,blink,joy,sad,sleepy
python3 frontend/tools/blender/finish_pets.py /tmp/pets frontend/public/pets
```

Add a stage name after the folder (`baby`, `king`) to render only that one. Each render takes about half a minute, so all 21 take about ten.

The first step renders each pet at 1024 pixels with no background. The second trims it to the pet, centres it on a square and paints a small soft shadow under it. It writes the resting face as a 640 pixel PNG (the old file names), and every mood as WebP in `public/pets/m/` at 512 pixels and at 128 for avatars: 42 files, 760 KB in all. Every mood of a stage is trimmed with the same box, so the frames sit exactly on top of each other. (A real shadow plane in the render greyed the whole floor, so the shadow is added afterwards.)

## Changing a pet

Each stage is one short function in `build_pets.py`. A body is a list of soft balls that fuse into one skin: position, radius, and stretch on each axis. `jelly(name, colour, deep colour, density)` sets the material: a higher density is a deeper, less see-through gel.

## Where they are used

`frontend/lib/pets.ts` maps a player's level to a stage and a file in `frontend/public/pets/`. File names did not change, so nothing else had to.
