# NEPA: Up Light. PRD + Architecture + Status

> GameArena's Naija-culture reaction game. Built to ride the Lagos-games wave with the hook the clones can't copy: you actually earn real G$. Verified humans, on-chain weekly rank, no download, in MiniPay.
>
> Status: BUILT (playable end to end, shadow-mode anti-cheat live) on branch `nepa-up-light`. Pending go-live steps in Section 11. gameType `4` · Author: GameArena · Updated 2026-10-05

---

## 1. Why this, why now

A viral wave of Nigerian browser games (drive a danfo through Lagos; "Lagos Life") is trending (#lagoslife). They prove demand, distribution, and the cultural formula, but they have no reward, no verified-human competition, no persistent identity, no payout rail, and a novelty cliff. GameArena closes all five.

- "UP NEPA!" is the single most universal Nigerian grievance, an open lane with no notable web version.
- It is a genuinely new loop, not a reskin, so the "I built this" share moment lands.
- The headline the clones structurally cannot write: *"charge the most before light goes, top the weekly board, win real G$."*

**Positioning:** the Lagos games made Nigerians play; this is the one where playing your Lagos story actually pays.

---

## 2. Goals & success metrics

| Goal | Metric | Target (first 2 weeks) |
|---|---|---|
| Ride the wave | Plays in week 1 | 5,000+ |
| Convert viral top-of-funnel | New GamePass mints from NEPA | 300+ |
| Real humans, not bots | Verified players on the NEPA board | 60%+ of ranked |
| Retention hook | D7 return rate | > site baseline |
| Social | Quote-tweets of the result card | the viral moment |

Non-goal: a deep/long session game. This is a ~40s skill burst, instantly grasped from a silent clip.

---

## 3. Game design

### 3.1 Premise
Power just came on. You have 3 sockets and a wall of devices that all need charging. Plug in the highest value-per-second devices and bank them before NEPA takes the light.

### 3.2 Core loop (single tense session, 40s fixed)
1. "UP NEPA!" opens the round. The big meter voice plays, the light comes on, the 40s clock starts.
2. A tray of device cards sits below three sockets. Each device has a value (₦) and a charge time (seconds of light-on time to fill).
3. Tap a device to plug it into a free socket. It charges only while the light is ON.
4. **Banking is TAP-TO-GRAB (changed from the original auto-bank plan).** A full device does NOT auto-collect. It sits READY in its socket showing "TAP TO BANK" until the player taps the socket to collect its value and free it. Tapping a still-charging socket UNPLUGS it: the device is wasted and the combo resets. You can bank a full device even during a light cut (collecting a finished charge needs no power; only charging needs light).
5. Power cuts at seed-randomized intervals. While the light is OUT, charging pauses.
6. The session ends at the 40s clock. Any device still sitting in a socket, charging or full, is forfeit. There is no end-of-game sweep: you must bank before time runs out. **Score = total ₦ value banked.**

### 3.3 The skill (why it ranks fairly)
Triage under pressure: pick highest value-per-second, manage three sockets, race the random cut (don't start an 8s fridge when light might go in 3s), and remember to grab a finished charge before time or a hazard takes it. A combo multiplier rewards clean, consecutive banks, so a sharp run clearly beats a sloppy one. Pure decision skill; no luck payout, no idle.

### 3.4 Entities (shipped tuning table)

Seven permanent devices plus one rare golden device. Values and charge times are mirrored byte-for-byte between the client (`frontend/app/games/nepa/page.tsx`) and the server replay (`games-backend/lib/nepaScoring.js`).

| Device | id | Value (₦) | Charge time | Role |
|---|---|---|---|---|
| Phone | `phone` | 8,000 | 2.0s | fast, safe, low value |
| Rechargeable lamp | `lamp` | 10,000 | 2.5s | safe |
| Power bank | `powerbank` | 12,000 | 3.0s | balanced |
| Rechargeable fan | `fan` | 15,000 | 4.0s | mid risk |
| Pumping machine | `pump` | 25,000 | 5.0s | high value, high risk |
| Inverter battery | `inverter` | 30,000 | 6.0s | high value, high risk |
| Small fridge | `fridge` | 40,000 | 8.0s | jackpot, big gamble |
| Golden freezer ("ac") | `ac` | 80,000 | 7.0s | RARE, seed-windowed chest (see 3.6) |

### 3.5 Combo multiplier
`comboMult(combo) = 1 + 0.15 * min(max(combo - 1, 0), 6)`. combo 1 pays ×1.00; each further consecutive bank adds 0.15, capped at combo 7 and up → ×1.90. An early unplug (and the rat, see 3.6) resets the combo to 0. Letting a full device sit unbanked does NOT break the combo; only a valid bank advances it and only an early unplug resets it.

### 3.6 Chaos / fun mechanics (NEW vs the original plan)

All five are seed-driven, cheat-proof, and re-derived identically in both replay copies, so they add drama without opening a cheat surface. The four automatic events are drawn from a PRNG stream (`"<seed>:events"`) that is SEPARATE from the light schedule, so adding or tuning them never shifts the light timing. Windows may overlap and their multipliers STACK.

- **Double money**: one ~5s window (starts 8-20s in) where every bank earns ×2.
- **Final-10s frenzy**: every bank in the last 10s earns ×1.5. Stacks with double money for up to ×3 on a single bank.
- **Golden freezer ("ac")**: the rare chest device: ₦80,000 / 7s charge, pluggable ONLY inside an ~8s availability window (starts 10-25s in). Its card appears only during the window; a plug outside it is rejected.
- **Rat chops wire**: a rat fries one socket (seed-chosen, 0-2) for ~4s (starts 13-26s in). Whatever charges in that socket when the window opens is wasted and the combo resets; the socket can't be plugged while the rat owns it.
- **Generator power-up**: the player's one `"gen"` action per run opens a 6s window where OUT segments still charge, so a device finishes THROUGH a blackout. Only the first pop counts; it re-derives the completion time for anything already in a socket. In the UI it coughs the Lagos generator idle back to life.

### 3.7 States
`idle` → `ready (UP NEPA! intro)` → `playing (light ON/OUT cycles)` → `gameover (score + result card + submit)`. Reuses the shared mint/guest/save-run overlays, `useGameJuice`, and the full submit flow.

### 3.8 Fairness & seed (critical for ranking)
Each run is driven by a server-issued seed minted in `/api/start-game` (`crypto.randomBytes(16).toString('hex')`) and stored on the `game_sessions` row, so the client can't choose a favorable schedule. The seed fully determines the light-cut schedule and the four automatic chaos events. The client logs its discrete input events (`plug` / `unplug` / `bank` / `gen`, each with a ms offset). Given seed + input log, the score is deterministically reproducible, so the server replay validates it (see Section 5). The seed changes every run, so there is no memorized perfect path.

**Light schedule** (pure function of `"<seed>|light"`): alternating ON/OUT windows starting ON. ON windows shrink from ~6000ms to ~2500ms across the session with ±750ms jitter (floor 2000ms); OUT windows run 1200-3000ms and are erratic.

---

## 4. Reward model
- Weekly leaderboard, G$ to the top ranks (same engine as Rhythm/Simon/Stack). Rewards follow rank, not per-play, so grinding doesn't farm value.
- Entry/earning gated by GoodDollar verification, the one thing that makes a prize board bot-safe. Free play open to all; ranking + G$ require a verified GamePass.
- Natural extensions (not v1): a Friend Duel on an identical seed (head-to-head staked G$), and a Tug of War team skin.

---

## 5. Anti-cheat (bank-event replay model)

Mirrors the Stack/Simon pattern (`games-backend/ANTICHEAT.md`).

- **Replay model.** `games-backend/lib/nepaScoring.js` is a pure server replica: given `{seed, inputLog}` it recomputes the authoritative score. A `plug` occupies a free socket; `chargeCompleteTime` derives `bankT`, the earliest ms the device is full. A `bank` credits ONLY IF, at the logged `t`, that socket still holds that device AND `t >= bankT`. Anything else (early bank, empty socket, device mismatch) is ignored with no state change. This `t >= bankT` test is the core guard: a tampered client cannot grab before the seed says a device is full. An early `unplug` wastes the device and resets combo. Devices still in a socket at session end are forfeit.
- **Two copies in lockstep.** The frontend ships a TypeScript port of the exact same algorithm (same PRNG, light schedule, events, charge math, combo). The SUBMITTED score is itself a replay of the client's own input log, so client and server points match by construction and honest shadow deltas are ~0. The rosters and config constants (`SESSION_MS=40000`, `SOCKETS=3`, `NAIRA_PER_POINT=1000`) MUST stay identical or the delta drifts.
- **Tests.** `lib/nepaScoring.test.js` holds 37 tests: determinism, the tap-to-grab timing rules (early/late/during-cut banks, forfeit, no-auto-bank), combo growth and cap, socket sanity, roster parity, the ₦ ≤ points bound, double money / frenzy / stacking, golden window, rat, and generator. The client port and the server module were cross-checked for parity; run the suite with `node --test lib/nepaScoring.test.js`.
- **Humanness (shadow, Step 2).** `computeNepaHumanness` flags (never yet rejects) a log whose input rate exceeds ~10/s or that addresses an out-of-range socket.
- **Shadow mode.** Live now in `/api/sign-score`: the server replays the log against the stored seed and LOGS the comparison (`serverPoints` vs `clientPoints`, delta, humanness, banked/wasted/maxCombo). It signs the CLIENT's claimed score (points = ₦ banked / 1000, clamped ≤ 1,000,000), not the replay score, so an imperfect port cannot reject a real player. The replay log is capped at 1,000 events. Enforcement flips later (Section 11).

---

## 6. Score model
- `nairaScore` = total ₦ banked (the display value).
- On-chain `points = floor(nairaScore / 1000)`, clamped to `[0, 1,000,000]` (the contract score bound).
- Backend `SCORE_DIVISOR` for season points: `nepa` = 20 (a strong run of 0-500+ points normalizes to the 0-15 season band). `WIN_THRESHOLD` for nepa = 50.
- Seed minted server-side in `/api/start-game`; points signed in `/api/sign-score`.

---

## 7. Architecture: how it plugs in

**No contract redeploy** (`gameType` is a free `uint8`; nepa = 4). **No subgraph change** to ship weekly-ranked: the per-game board reads the generic immutable `Score` entity filtered by `gameType`, and `totalScores` auto-counts. A subgraph redeploy is needed only later for per-player bests and the all-time/Events combined board.

### 7.1 Data flow (reused verbatim)
`/api/start-game` (session token + seed) → play → `/api/sign-score` (server shadow-replay via `nepaScoring`, then gasless `enqueueScoreWrite(player, 4, score)` → backend signer calls `recordScore`; fallback = EIP-712 voucher) → on-chain `ScoreRecorded(gameType=4)` → subgraph writes a generic `Score` row → `/api/submit-score` (XP, rank, achievements) → weekly board reads `scores(where:{gameType:4})`.

### 7.2 What shipped (files touched)

**Backend:**
- `games-backend/server.js`: `GAME_TYPE.nepa = 4`, `GAME_LABEL.nepa = 'Up NEPA!'`, `WIN_THRESHOLD.nepa = 50`, `SCORE_DIVISOR` branch for nepa = 20; seed minted in `/api/start-game`; shadow-replay block in `/api/sign-score`; reverse map `{4:'nepa'}`.
- `games-backend/lib/nepaScoring.js`: the replay replica + `computeNepaHumanness`.
- `games-backend/lib/nepaScoring.test.js`: 37 tests.
- `games-backend/supabase-migrations/2026-10-04_game_sessions_add_nepa.sql`: widens the `game_sessions` game CHECK to allow `'nepa'` and adds a nullable `seed` column.

**Frontend:**
- `frontend/app/games/nepa/page.tsx`: the game (React DOM + CSS, a single rAF loop, the TS replay port, the phone-stage layout, the two-state painted background cross-fade, the reactive CSS lighting, the wired pidgin voice, full submit flow).
- `frontend/app/games/nepa/NepaScene.tsx`: the ambient Canvas2D scene layer. Visuals-only, lazy-loaded client-only, a pure function of `lightOn`/`phase`/`reduceMotion`/`sceneEvent`. It imports nothing from the scoring, replay, submit or wallet code.
- `frontend/app/actions/game.ts`: `'nepa'` in the `GameId` union; `NepaInput` / `NepaShadow` types; nepa shadow fields threaded into `signScore`/`submitScore`.
- `frontend/lib/subgraph.ts`: `GameTypeId` widened to `0 | 1 | 2 | 4`; weekly board queries work for 4; `bestNepaScore` mapped but returns `null` (see 7.3).
- `frontend/hooks/useAppAudio.ts`: the NEPA groove bed, the inverted ambient generator, the relight crowd cheer, the real meter-sample voice, and the wired pidgin voice lines (Section 9.2).
- Leaderboard wrapper + hub tile + `SkillLeaderboardTabs` enum maps (shared skill-game plumbing).

### 7.3 Subgraph fast-follow
nepa (gameType 4) is rankable on the weekly board today because the board reads the generic `Score` entity. The per-player best field (`bestNepaScore`) and all-time/Events inclusion are deferred: the deployed schema has no nepa best field, and `src/gamepass.ts`/`helpers.ts` only bucket gameTypes 0/1/2, so gameType 4 falls through those hardcoded buckets. `getPlayerBest`/`getBestField` in `subgraph.ts` return `null` for 4 until the schema ships. This needs a schema add (`bestNepaScore`, `nepaPlays`, `totalNepaPlays`), an `else if (gameType == 4)` branch, and a Goldsky redeploy.

---

## 8. Build choices worth noting (changed from the original plan)
- **Rendering: React DOM + CSS + a Canvas2D ambient layer, not a game engine.** The HUD, sockets, tray, charge bars and chaos banners are plain React elements ticked by one `requestAnimationFrame` loop. The painted room is two stacked `<img>` frames that cross-fade on the light state. A single lazy-loaded Canvas2D layer (`NepaScene`) paints the ambient light dressing (bloom, dust, moths, phone glow, bank sparkle) over the painting. Inline SVG survives only as the per-device `onError` fallback glyph. (The original PRD templated this off Stack's canvas and described an inline-SVG-only scene; both are now out of date.)
- **A WebGL engine was evaluated and deliberately not adopted.** Pixi / Phaser / three.js each carry a real bundle and CPU cost that a 40s burst on MiniPay and low-end Android can't justify. The living scene is instead a layered DOM + Canvas2D approach, and the canvas stays strictly visuals-only (a pure function of its props), so the anti-cheat replay and the score / leaderboard / identity pipeline are never touched by scene work. `NepaScene` copies Stack's shared canvas pattern, which is the on-ramp if a future game ever needs a heavier scene.
- **Scoring is a pure replay, not a running tally.** The live HUD shows an optimistic score as you bank, but the authoritative game-over score is recomputed by replaying the recorded input log, so what the player sees equals what they submit.
- **Banking changed from auto-bank to tap-to-grab** (the single biggest design delta; see 3.2).

---

## 9. Presentation & assets (shipped)

### 9.1 Presentation / layout
- **Phone stage.** The whole game renders inside a fixed 9:16 stage (`.nepa-stage`). On desktop that stage is a centered phone frame (rounded corners + drop shadow) sitting on a blurred, dimmed copy of the room art (`.nepa-backdrop`), so the game never shows black letterbox bars. On phones (`max-width: 480px`) the backdrop is hidden and the stage goes full-bleed (100vw × 100dvh, no radius). Every layer (painted bg, canvas, CSS lighting, HUD, sockets, tray, pet, bulb, phase views) lives inside the stage so they share one coordinate space.
- **Control-deck split.** The playing view splits into a top zone (~42%) and a bottom control deck. The top zone carries only the slim HUD (banked ₦, points, combo, time) and the light meter over the painted room, and is `pointer-events: none` so taps pass straight through the painted people. The deck pins the three sockets, the generator button, the device tray and END RUN to the bottom, over a bottom-up scrim that lifts the tappables off the art without covering the room.
- **One-viewport fit.** The deck is `overflow: hidden` with `min-height: 0` flex children and compacted sockets/cards, so the full control surface fits one viewport on short screens instead of pushing END RUN off-screen or scrolling.

### 9.2 Scene / "feel real"
- **The inhabited painted room.** `frontend/public/games/nepa-bg.png` is a lit, inhabited Lagos living-room scene (people in the room, a neighborhood through the window). A radial-gradient dark-room base is the fallback if the image fails.
- **Two-state painted cross-fade (replaces the old brightness filter).** The blackout is now real art, not a dimmed photo. A second painted frame, `frontend/public/games/nepa/nepa-bg-out.png` (bulb off, room dark, phone still glowing), stacks over the lit frame and cross-fades in on the light cut (300ms opacity). If the blackout frame 404s, the code falls back to the old brightness-dim on the lit frame, so a missing asset never breaks the scene.
- **Reactive CSS lighting.** Screen-blended CSS layers react to the light state at the edges the loop already fires: a warm amber bulb-glow pool while the power is on, a power-trip flicker on the cut (the first cut of a run flashes bigger), a filament relight surge on the return, and a pre-cut voltage dip (bulb sag + soft "vrrm" ~0.5s before a cut) as the mains sag "tell." All decorative layers are gated off under `prefers-reduced-motion`.
- **NepaScene canvas dressing.** The lazy Canvas2D layer paints the ambient light reactions over the painting: the hanging-bulb bloom (breathes while on, snaps dark on a cut, overshoots on relight), rising dust/embers and orbiting moths inside the bulb cone, a steady cool phone-screen glow that survives a blackout, and a gold bank-sparkle burst near the sockets. It is capped hard for low-end Android (≤22 dust motes, ≤3 moths, a small spark pool), pauses on tab-hidden/blur, and freezes motion under reduced-motion. The earlier crude window/silhouette drawing was removed; the canvas now only paints light on the real painting.
- **Device sprites.** Realistic photographic Naija device PNGs at `frontend/public/games/nepa/devices/*.png`: `phone`, `lamp`, `powerbank`, `fan`, `pump`, `inverter`, `fridge`, and the golden `ac` freezer. A fixed square box + `object-fit: contain` keeps varied aspect ratios from distorting; the inline-SVG glyph per device stays as the `onError` fallback.
- **Pet companion.** The corner pet reacts in place: bank celebrate, cut wilt, relight cheer, and a final-5s panic.

### 9.3 Audio
- **Groove bed.** A PROCEDURAL Lagos amapiano/afrobeats loop synthesized in Web Audio at 112 BPM (not an mp3). It runs on its own `musicOn`-gated bus, snaps to silence on a blackout and slams back in phase on relight, and lifts to a driving mode (extra kicks/hats, octave doubling) for the final 10s.
- **The real "UP NEPA" meter sound.** `public/games/nepa/up-nepa.mp3` (the full ~8.8s meme voice) plays as the round opens on the ready beat, ducking the groove under it. `public/games/nepa/up-nepa-beep.mp3` (the ~1.7s iconic prepaid-meter beep) is in the repo as an available relight sound; relight currently fires the pidgin "up" voice + crowd cheer instead, so the beep sample is not wired today.
- **Wired pidgin voice lines.** Authentic Nigerian Pidgin TTS clips (via PlotWeaver Nigerian Pidgin) at `public/games/nepa/voice/{up,cut,combo}.mp3` are now WIRED in `useAppAudio.ts` (correcting the earlier note that they shipped but were unwired): `up.mp3` ("Up NEPA! dem don bring light") on every relight, `cut.mp3` ("Ahhh NEPA don carry light") on the light cut, and `combo.mp3` ("Oya charge am sharp sharp") once per run when the streak hits combo 5. A ~1.2s throttle stops a rapid light toggle from stacking two lines, and each line ducks the groove while it plays.
- **Ambient generator inversion + relight cheer.** The gated "putt-putt" generator idle is INVERTED from the old model: the light now starts ON with the street gen quiet, the neighbours' gen roars up ~1.5s into a blackout, and it winds back down on relight (unless the player's own GEN power-up window is still open). A short, bright crowd "ayyy" cheer plays under the pidgin voice on each relight.
- **SFX.** Plug, bank (combo-scaled pitch), combo milestone sparkle, the signature power-down cut, reject, unplug, a synth countdown beep for the final seconds, and game over. A persistent charge hum tracks the count of actively-charging sockets.

**Rights note:** the "UP NEPA" meter sound is a TikTok meme sample, fine for the demo. Confirm or replace it before any commercial use.

---

## 10. Risks & open decisions
- **Score bound:** ₦ values exceed the on-chain score cap, so banked ₦ scales down to points (₦1,000 = 1 pt), clamped ≤ 1,000,000. ₦ shows in the UI. (Decided and implemented.)
- **Balance:** value/charge-time/cut-window and the chaos windows are the make-or-break; reserve real playtest time.
- **Anti-cheat enforcement:** shipped shadow-mode first (like Stack); enforce after parity (Section 11).
- **Scope:** v1 = single mode, 3 sockets, weekly board, the five chaos mechanics. Friend Duel / Tug skin / socket upgrades are fast-follows.

---

## 11. Current status

### 11.1 Built (on branch `nepa-up-light`)
- The full game: tap-to-grab banking, 3 sockets, 40s session, seed-driven light schedule, combo multiplier, and all five chaos mechanics (double money, final-10s frenzy, golden freezer, rat, generator).
- The pure replay in both copies (TS on the client, JS on the server) with 37 passing tests.
- Shadow-mode anti-cheat live in `/api/sign-score` (replays, logs the delta + humanness, signs the clamped client score).
- Backend enum/label/threshold/divisor edits, the seed endpoint, and the supabase migration file.
- The presentation pass: the phone-stage layout (desktop phone frame + blurred backdrop, mobile full-bleed) and control-deck split, photographic device sprites, the two-state painted background cross-fade, the reactive CSS lighting, and the `NepaScene` Canvas2D ambient layer.
- The audio pass: the procedural 112 BPM groove bed, the full "UP NEPA" meter voice on round open, the wired pidgin voice lines (up/cut/combo), the inverted ambient generator, the relight crowd cheer, and the synth SFX kit.
- Frontend integration: game page, leaderboard wrapper, hub tile, `subgraph.ts`/`game.ts` edits (weekly board reads gameType 4).

### 11.2 Pending to go live
1. Push the `nepa-up-light` branch.
2. Deploy the backend to Railway (so `/api/start-game` returns the nepa seed and `/api/sign-score` runs the shadow replay).
3. Apply `supabase-migrations/2026-10-04_game_sessions_add_nepa.sql` (adds the `seed` column and widens the `game_sessions` game CHECK to include `'nepa'`; without it, `/api/start-game` for nepa 500s).

### 11.3 Enforcement roadmap
1. Model device spawn/inventory in the replay (what the tray actually offered each run) and tighten the humanness heuristic beyond rate + socket sanity.
2. Once real-run parity holds in the shadow logs, switch `serverScore` to the replay points so the signed score is the server's, not the client's.

### 11.4 Subgraph fast-follow
Add the nepa best fields + an `else if (gameType == 4)` bucket in `src/gamepass.ts`/`helpers.ts`, then redeploy to Goldsky, to unlock per-player best and all-time/Events inclusion (see 7.3).

---

## 12. Go-to-market (the drop)
- Silent autoplay clip of a NEPA run (grasped in 3s).
- First-person "I built this" thread (founder account, pidgin, hyper-specific: "you get seconds before NEPA carry light").
- Quote-tweet into the live #lagoslife chain: made you play, this one pays. Verified humans, real G$, no download, MiniPay.
- Result-card flex: *"I charged ₦47k before NEPA carried light. Beat that → gamearenahq.xyz"*.

---

## 13. UP NEPA 3D World (upgrade roadmap)

The next evolution: a walkable 3D UP NEPA neighbourhood. It does NOT replace the 40s 2D
game (that stays as-is), and it is NOT a competitor to the Naija builder wave (Lagos Life,
Lagos Tycoon, allworld). It is our own lane, inspired by their energy and techniques.

### 13.1 Positioning
- Own lane: nobody else's game is "race NEPA for the light". The 3D world is the UP NEPA
  universe, not a generic Lagos social sim.
- Inspired, not competing: studied kromate/allworld for the techniques (web 3D, mobile
  perf, characters, multiplayer) only. We build our own code and use our own / free assets,
  and credit the wave publicly.
- Stays inside GameArena: a new `/world` route in the same Next app, same shell, same
  identity / score / leaderboard pipeline. Lazy-loaded client-only so it never bloats the
  other routes.

### 13.2 Tech decisions
- React-Three-Fiber (@react-three/fiber v9 for React 19) + @react-three/drei v10 + three
  0.186 + zustand. No heavy game engine (Phaser/Unity), and no real-map runtime (MapLibre):
  the key lesson from allworld is that their "3D on real maps" is a data pipeline, not a
  rendering trick, and a game does not need it. We hand-build a stylized scene.
- Visuals-only and additive: the 3D layer never touches scoring, the anti-cheat replay, or
  existing routes.
- Mobile-first perf governor (the MiniPay / low-end-Android survival kit): capped dpr, 30fps
  throttle on mobile, pause-on-hidden, one shadow-casting light, instanced props, degrade-
  only quality under load, fog as the draw-distance cap, lazy-loaded 3D bundle behind a tap.

### 13.3 Assets (chosen path: free stylized, runs everywhere)
- Free / CC0 low-poly models (Quaternius / Kenney / Mixamo-style). Looks good, runs on
  cheap phones. Not photoreal (which would not run on MiniPay anyway).
- M1 uses a CC0 placeholder character + procedural primitives; the danfo and buildings are
  original stylized shapes (generic, no real brand). Real Lagos-styled models land in M2.

### 13.4 Milestones
- M1 (DONE, branch nepa-up-light): walkable stylized Lagos street at `/world`. The NEPA
  LIGHT CYCLE (ON ~26s -> CUT 5s -> RELIGHT 1.6s, on a timer + the `N` key / an on-screen
  button). Reactive 3D lighting: street lights + building window emissives toggle, the scene
  drops to moonlight-blue with a generator glow + a phone-screen glow during the blackout,
  and floods warm with a flicker on relight. HUD ("NEPA carry light!" / "UP NEPA!" + a power
  meter), third-person spring-lerp follow cam, camera-relative WASD + a touch joystick, and
  the perf governor. Proves the engine and the NEPA-in-3D concept. Files: `frontend/app/world/`
  (World, Scene, Lights, NepaDirector, Street, Buildings, StreetProps, Danfo, Player,
  Joystick + controls/store/audio).
- M2 (DONE, branch nepa-up-light): a stylized everyday-Lagos character (free generic rig,
  re-tinted terracotta, walk/idle crossfade, foot-slide + facing fixed) + richer street
  (instanced potholes/gutters, poles with a sagging-wire run, a keke, rooftop tanks/AC,
  no-brand signboards, more stalls), the blackout polished (deeper moonlight-blue, staggered
  window relight, a warm surge flare + exposure bump, flickering lanterns/generator/phone),
  and the pidgin "cut"/"up" voice + amapiano bed wired via an HTMLAudio manager (mute toggle).
- M3 (DONE, branch nepa-up-light): the 3D GAMEPLAY - the 2D loop made spatial. Devices
  (phone/lamp/power bank/fan/inverter/fridge, cheap-fast vs slow-rich) sit around the hood;
  you walk onto one and stand in its charge ring to fill it while NEPA gives light, it banks
  its ₦ value (ka-ching + popup) and goes on a 6s cooldown, and charging stops dead during a
  blackout. 75s round with a live timer + score, a nearest-device prompt (charging % / "no
  light" / "cooling down"), and a GAME OVER summary (total banked, device count, biggest
  grab, Play again). Hot per-frame state (progress/cooldown) is allocation-free in
  game.ts/GameDirector/Devices; only the HUD numbers are reactive. Self-contained and scored
  locally - deliberately NOT wired to on-chain submission yet (no anti-cheat replay for the
  spatial loop); pipeline hook-up is a later milestone once the honest-run model exists.
- M4 (next): wire the 3D loop into the GameArena score / leaderboard pipeline once a spatial
  anti-cheat / honest-run model exists; then multiplayer presence (see your neighbours in the
  hood) via WebSocket / Durable Objects with interest radius + binary move batching (allworld
  techniques), more districts, danfo / keke you can ride.

### 13.5 Risks
- Scope: multi-week and asset-dependent. M1 proves the tech cheaply before any big investment.
- Perf on the cheapest phones: the governor + stylized-low-poly is the mitigation; keep draw
  calls and resolution down.
- Momentum: do not let the 3D build cannibalize the 2D game's launch. Ship / keep the 2D
  game; treat the 3D world as the headline "where this is going".

### 13.6 Multi-mode gameplay plan (current direction)

The 3D world is now a MODE-SELECT game: one shared Lagos street, several NEPA games. The
"charge devices around a city" single-loop idea was dropped (it made no spatial sense and was
passive). Two rules govern every mode:

1. **Every action is a SKILL MOVE, never a collision.** Walking into a radius does nothing; a
   timing meter (a sweeping marker + a green sweet-spot) pops and you must TAP in the green
   (screen tap, an on-screen button, or Space; shared via `worldControls.actionTap`). Dead-centre
   = PERFECT (bonus). Mistime it and it sparks / fumbles. Difficulty ramps (faster sweep, smaller
   green) as the run goes.
2. **The timer means something DIFFERENT per mode** (it is not a generic beat-the-clock):
   - **Restore the Light = SPEEDRUN.** Clock counts UP, your TIME is the score (fastest wins);
     no fail-clock, just a soft cap. Light all breakers; each is a timing flip; later ones are
     harder. BUILT.
   - **Charge Rush = the light window.** NEPA gives light for a shrinking window; plug devices in
     (timing tap) and stack a combo before the cut; caught lined-up at the cut breaks the combo.
     BUILT (reworked from hold-to-fill to the timing tap).
   - **Torch in the Dark = the darkness window** (count down): you have the blackout window to
     grab your things before NEPA restores light and you're exposed. Thematic countdown. TODO.
   - **Generator Hustle = NO clock, survival:** play until every zone has gone dark (all gens run
     dry); how long you last is the game, score = ₦ earned. TODO.
   - **Power Thief = NO clock, 3 strikes:** play until the NEPA official catches you 3 times;
     score = houses lit. TODO.

   So across the five: one stopwatch (Restore), two thematic windows (Charge, Torch), and two with
   NO countdown at all (Generator survival, Power Thief strikes). Not every mode is a race clock.

Scoring is one integer 0..1,000,000 per run for the GameArena leaderboard. Build order for the
remaining three: Torch -> Generator -> Power Thief (easiest + most novel first). Each new mode =
3 files ({Name}Director.tsx, {Name}Props.tsx, HUD in World gated by appMode) + a ModeSelect card +
an appStore mode; the street / buildings / cars / character / camera / lighting are shared.
