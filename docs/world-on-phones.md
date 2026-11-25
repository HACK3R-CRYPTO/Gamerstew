# UP NEPA 3D on phones

What was wrong on a phone, what was changed, and how to check it. Fixed on 2026-11-25 after reports from an iPhone 13.

## 1. The picture was not sharp

**Cause.** The world decides once how detailed to draw (`app/world/quality.ts`). A phone that reported 4 processor cores or fewer was called "weak" and drawn at 1 device pixel per screen point. Every iPhone reports 4 or fewer, whatever chip it has. An iPhone 13 has 3 device pixels per point, so it was drawing a third of the detail its screen can show.

**Fix.**
- iPhones and iPads are never called weak.
- Phones start at 2 device pixels per point. Low-end and in-app browsers start at 1.5.
- The frame loop (`FrameGovernor` in `app/world/Scene.tsx`) watches the real frame rate. If a phone runs well under its target for four seconds, the picture is made one step softer, down to a floor. A level that proved too much is not tried again, so the picture never flips back and forth. The first five seconds are ignored, because loading stutters on any phone.
- It also steps UP. The tier is a guess from what a phone says about itself, and phones say little. If a phone runs easily for six seconds, the picture is made one step sharper, up to 2 pixels per point or the screen's own limit. So an unknown phone, or a strong one opened inside WhatsApp, is not stuck with a low guess.
- A normal phone now targets 60 frames a second. The old cap waited a full 16.67 ms between frames; screens tick at 16.6, so it skipped every other tick and a 60 target ran at 30. It now allows 3 ms of slack.

Measured on an iPhone 13 sized screen: 390×664 drawn before, 780×1328 after. The scene costs about 89 draw calls and 63,000 triangles on the phone tier, which is light; sharpness was the problem, not load.

## 2. The camera and controls

The model is a shooter on a phone: **the left half of the screen moves, the right half looks, both at once**, with the phone upright or on its side. And it still plays with one thumb.

| Before | After |
|---|---|
| Only a small pad in the corner moved the player. A left thumb that landed a little off it fell on the 3D view; the view then had two fingers on it and read them as a pinch. Two thumbs did not work | The whole left half of the screen is the stick's area, and the stick appears under the thumb. Two fingers are never a pinch on a phone: zoom is for the mouse wheel |
| An iPhone could take two thumbs for a page zoom and cancel both touches | The browser's own pinch gestures are refused on this page |
| The lens was set for a wide screen: on a tall phone the street was a 30 degree keyhole | A tall screen gets a wider lens (70 against 55) |
| The camera sat 11 m back and high: the character was a speck | It starts about 7 m back and lower, behind the player |
| The view never turned by itself, so a player with one thumb could not see where they were running | The camera swings round behind the player wherever they run, in about a second and a half |
| Turning the view took a long swipe | The view turns further per swipe on a phone |

**Why the stick's directions are fixed while it is held.** With the camera turning by itself, a stick read against the live camera would chase its own tail: push down to run back, the camera swings behind you, and "down" now means the opposite way. So on a phone the stick's directions are taken from where the camera was when the thumb pushed, and stay until the thumb lets go, changes direction by more than about 35 degrees, or the player turns the view by hand. Measured: push down and hold, the player runs 9 m in a straight line and the camera ends within 2 degrees of directly behind.

**The player chooses who turns the camera.** "Follows you" is the default. "You turn it" switches the following off: the camera then moves only when the right thumb drags it, as in a shooter on a phone, and the stick is read against the live view. The choice is on the mode screen (the Camera button under "Play with friends") and in Settings → Gameplay → 3D camera, and is kept on the device. Measured on "You turn it": the stick held down for 2.4 s turned the view by 0.1 rad (the tail of a drag settling), against 3.1 rad when following.

The camera leaves the view alone for 1.6 s after the player turns it by hand, so two-thumb players keep the angle they chose.

The stick's area sits under the on-screen buttons, so every button is still pressed. A quick tap inside it that does not move counts as the game's tap.

**Minimap** (`app/world/Minimap.tsx`). A tall strip on the right edge, where neither thumb rests: the player as an arrow, breakers as rings (gold once lit, red when about to trip), or in Charge Rush the waiting devices and the charging table. With the camera low behind the player, it is what says the last dark breaker is behind them. It is a small 2D drawing refreshed eight times a second from positions the game already keeps.

The mode screen tells phone players they can turn the phone sideways for a wider view. Nothing forces it.

## 3. Things that broke on small phones

- **Arms stuck in the air.** Leaving Charge Rush while carrying a device left the "carrying" state set, so the character walked into Restore the Light with both arms up. Leaving the mode now puts the item down, and arms only rise in Charge Rush.
- **The room-code box ran off the screen.** A text box has its own minimum width of about 20 characters. In the "Play with friends" sheet that pushed the Join button off a narrow phone. The box may now shrink.
- **Mode cards opened half-way between two cards** on some phone browsers. The row now always opens on the first card and snaps one card at a time.
- **Text on top of text in Charge Rush.** The two-line how-to sat in the middle of the screen as bare white text, over the character and under any message. It is now one line on a dark plate above the stick, and it goes away once something is picked up.
- **A chip ran off the right edge in Restore the Light.** The top row now wraps.
- **Price tags filled a corner of the screen** when a device was near the camera. They now keep about the same size on screen at any distance.

## How to check

`/tmp/gaqa/nepa-shots.cjs` and `nepa-ctl.cjs` (local, not in the repo) open the world as an iPhone 13 inside an in-app browser (390×664 at 3 pixels per point) and as an iPhone SE (320×568). They screenshot each screen and measure: canvas size, where the cards and the Join button sit, whether the stick appears under the thumb, how far the character moves, how far the view turns, and what the scene costs to draw.

## Other phones: read the chip, then measure

Two steps, neither of them a guess.

**1. Read the graphics chip.** The browser will name the chip it draws with (`gpuName()` in `quality.ts`), and the chip is what decides how a 3D street runs. Memory and core counts do not: a phone with 8 GB and 8 cores can have a slow chip, and every iPhone reports 4 cores.

| Chip | Examples | Starts at |
|---|---|---|
| Strong | Apple, Adreno 640 and up, Mali G76 to G78 and G610 and up, Xclipse | 2 pixels per point, 60 fps |
| Mid | Adreno 610 to 630, Mali G52, G57, G68, G71, G72 | 1.5, 30 fps (lower set inside an in-app browser) |
| Weak | older Adreno, Mali G31, G35, G51, the T series, PowerVR (most budget Tecno, Infinix, itel) | 1.5, 30 fps, fewer walkers |
| Not named by the browser | | by memory and cores, as before |

**2. Measure, and adjust.** Whatever it started at, the frame loop watches the real frame rate:
- runs easily for six seconds: one step sharper, up to 2 or the screen's limit;
- well under target for four seconds: one step softer, down to a floor;
- at the floor and still short of 60: held to a steady 30, which looks better than a 60 that stutters;
- at 30 with room to spare: tried at 60 once.

A level that proved too much is never retried. So it does not matter how the player got here: a link pasted into Chrome, a link tapped in WhatsApp, or a phone released next year.

The number of walkers is fixed by the starting level and does not change while playing.

## The player's choice, memory, and the report

- **Settings → Gameplay → 3D graphics**: Auto (the default), Smooth, or Sharp. Smooth caps sharpness at 1.25 and holds 30 frames, for a phone that runs hot. Sharp draws at 2 and aims for 60. A chosen level is a ceiling: the picture is never made sharper than the player asked.
- **Remembered.** After twenty seconds of play the level a phone settled at is kept on that phone, tied to its graphics chip, for a month. The next visit starts there.
- **Street Strike uses the same check** (`app/world/AutoSharpness.tsx`), so both 3D games behave alike.
- **Reported.** Each visit to a 3D game sends one `device_profile` event: the chip, the level it started and settled at, and the frame rate it got. No person is named. The admin dashboard's Visits page turns these into a report: how many visits ran smooth or slow, by chip, by actual phone, by game, and which setting players chose. It needs `games-backend/supabase-migrations/2026-11-26b_admin_devices.sql`.

The report is the point. "It looks bad on my phone" becomes a number: which chips, how many players, how slow.

### What was considered and left out

- **A separate speed test before the game.** It delays the first play and measures an empty scene, not the game. Measuring the game itself while it is played is both quicker and truer.
- **A device-name library.** It reads the browser's description of itself, which gives the brand and browser. That is already known, and it says nothing about speed.
- **Refusing to run on a weak phone.** Nobody is turned away. A weak phone gets a softer picture and fewer walkers.

## Not verified

- The step from 30 up to 60. It relies on how often the screen ticks while frames are skipped, and the test browser on a laptop does not tick like a phone, so it could not be watched happening. If it tries and the phone cannot hold it, it goes back to 30 and does not try again.
- Frame rate on a real iPhone. A laptop's graphics chip is not a phone's. The governor is the safety net; a real device still has to confirm it holds 60.
- How the camera's help with steering feels in the hand. The numbers are right; feel needs thumbs.
