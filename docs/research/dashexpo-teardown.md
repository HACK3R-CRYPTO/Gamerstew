# DashExpo teardown (reference for the next GameArena build)

Target: https://dashexpo.vercel.app · captured 2026-11-22 with REA 6.10.1 (passive CDP inspection, static bundle analysis, scripted browser scenarios). Screenshots live outside the repo in `../dashexpo-reference/` (not committed).

Everything below is either observed in shipped bytes, observed in a controlled replay, or marked as an inference.

---

## 1. What it is

"One wallet, every game." A mobile-first arcade hub with one guest account, one coin wallet, XP levels, a 7-day daily reward, a "Today" quest row, and four games (Street Dash runner, Bowling, Darts, Whot!). Coins are won, never bought. Nigeria-targeted: Lagos world, Whot, WhatsApp share, "Players around Naija". No crypto wallet, no web3 code anywhere in the bundles.

---

## 2. Stack (observed)

| Layer | What they use | Evidence |
|---|---|---|
| Build | Vite + Rolldown, ES modules, content-hashed chunks | `rolldown-runtime-*.js`, `modulepreload` links |
| UI framework | None. Vanilla DOM (`getElementById`, template strings). No React/Vue/Svelte markers | 100 KB hub JS total |
| Shell | One `index.html` (46 KB) with every screen pre-rendered as hidden sections; client-side routes `/`, `/race`, `/bowl`, `/darts`, `/whot` all serve the same HTML | curl of each route = identical 46 165 B |
| 3D | Three.js (WebGLRenderer, GLTFLoader, FBXLoader, RoomEnvironment, InstancedMesh). Lazy chunks per game | `dash-start` 503 KB, three core 637 KB, `bowling`+`lane3d`+`lane-sim` 360 KB, `darts`+`board3d` 120 KB, `whot`+`table3d` 94 KB |
| Replay export | `mp4-muxer` chunk (in-browser video of a run, inference: for sharing) | 31 KB chunk |
| Realtime | socket.io-client (engine.io v4) to `https://gamesever.loodit.com`. Namespaces `/rt` (race rooms), `/tables` (Whot), `/bowl`, `/darts` | `online-*.js`, `esm-*.js` |
| REST | Same origin, `/api/*` (list in §6) | `index-*.js`, `account-ui-*.js` |
| Auth | Guest token first (`streetdash.pid`, `streetdash.token` in localStorage), optional passwordless email OTP (Resend) to "save progress" | `/api/auth/guest`, `/api/auth/otp/*` |
| Media | Looping muted AV1 mp4 covers per game card, webp previews, hub lobby music | `/previews/*-wide-av1.mp4` |
| Hosting | Vercel static | |
| Fonts | Fredoka 500/600/700 (display, everything) + Inter Tight 500/600/700 (game card body) via Google Fonts | `<link>` in head |

Audio is a hand-rolled WebAudio synth (oscillator melodies for level-up, coins) plus mp3 loops. Haptics via `navigator.vibrate`. Voice chat via `getUserMedia` (Whot tables, race rooms). Speech via `speechSynthesis` (announcer).

---

## 3. Design tokens (from `index-*.css`)

```css
:root { --accent:#ffc83d; --accent2:#2fbf71; --on-accent:#1a1400; --ink:#fff;
        --glass:#0e1122b8; --glass2:#ffffff14; --line:#ffffff24 }
.hub  { --bg:#07080f; --panel:#10121f; --panel-2:#161a2c; --line:#ffffff14;
        --ink:#f4f5fb; --dim:#f4f5fb9e; --gold:#ffd56b; --gold-2:#ffb020;
        --xp-a:#4be1ff; --xp-b:#a35cff; --hot:#ff4fd8;
        --ease:cubic-bezier(.2,.8,.3,1); --spring:cubic-bezier(.34,1.56,.64,1) }
```

- Per-game accent: dash `#ff3cc8`, bowl `#4be1ff`, darts `#ff3db8`, whot `#ff4d5e`.
- Tier colours: Bronze `#d08a52`, Silver `#c9d3e0`, Gold `#ffd56b`, Platinum `#7fe3d4`, Diamond `#7cc4ff`, Legend `#ff6bd6`.
- Radii: cards 22–24 px, pills 999 px, card dock 17 px, buttons 12 px.
- Surfaces: `linear-gradient(#ffffff0f,#ffffff06)` + 1 px `--line` border + `backdrop-filter: blur(14px)` + `box-shadow: 0 18px 40px -24px #000e`.
- Background: near-black `#050609` with a canvas particle layer (`#hubFx`), three radial glows, and an SVG fractal-noise grain at 7 % opacity.
- Motion: `.rise` elements fade/translate in with `--i * 70ms` stagger; cards tilt on pointer (`--rx/--ry`, perspective 1200 px); wallet pill `bump` on coin change; coin spin 4 s loop; `prefers-reduced-motion` kills all of it.

---

## 4. Hub layout (`/`)

Max width 1080 px, 16 px gutters (24 px ≥ 760 px). Sticky top bar gets a blurred backdrop once scrolled.

Order on the page:

1. **Top bar**: wordmark (bold "Dash" + dim "Expo"), round sound toggle with a tiny EQ animation while music plays, "Sign in" pill (hidden once signed in), gold wallet pill (coin icon + tabular count).
2. **Rejoin banner** (only when a live room/table/lane exists): pulsing dot, "Leave game", "Rejoin".
3. **Profile card** (whole card is a button → profile): 68 px avatar with SVG progress ring, level badge bottom-right, "WELCOME BACK / Guest", optional tier chip, XP bar, "Level 2 pays +70 coins".
4. **Daily reward card**: 7 tiles (Day 1…7 = 25/40/50/75/100/125/250 coins, +10/10/15/15/20/20/50 XP), today's tile highlighted and bobbing, animated conic border when claimable, big gold "Claim day 1: +25 coins" button, 🔥 streak count top-right.
5. **Today card**: quest rows with icon, title, sub-line (tries left dots), reward column (+coins, +XP) or a CTA chip ("Race").
6. **Games**: heading + "One wallet, every game". Hero card (21/9 ≥ 760 px, else 4/5) + 2-column grid of 16/10 cards. Each card: looping video cover, gradient shade, badges (FEATURED / NEW / "Continue playing" with breathing dot), meta line in tracked uppercase, 28–48 px title, 2-line blurb, and a glass "dock" holding an XP hint and a white "Play ›" button with a sweeping highlight.
   - Mobile (< 760 px): cards are `position: sticky` and stack as you scroll; the card underneath scales down and darkens (`--cover`). Footer gets `padding-bottom: 58vh` so the last card can settle.
7. **Footer line**: "One account and one wallet across every game. Coins are won, never bought."
8. **Level-up modal**: rays, "Level up!", big number, "+coins", "Nice!".

Loader: full-screen, four game icons swap in turn while an arc fills; hard-capped at ~13 s; `main.js` reports progress into it.

---

## 5. Per-game lobby pattern (`/bowl`, `/darts`, `/whot`)

Same skeleton for every game, over a live 3D ambient scene:

- Top row: "‹ Games" back, coin pill, kit/profile/how-to, music, sound (round 42 px buttons).
- Big Fredoka title + one-line tagline ("Swipe, hook, strike" / "Aim, steady, release" / "Match the shape or the number").
- **Hero mode tile** with icon, name, sub-line, and an **"Entry: Free ▾"** dropdown (entry-fee selector, coins). Bowling: "Quick match · Everyone bowls at once". Darts: "Party table · Up to 8 · everyone at once · 301". Whot: "Quick play · Players around Naija · starts when the table fills".
- Row of 3 tiles: **Ranked** (shows "Bronze 1000" = starting rating), **Friends** ("Your own lane/board/table"), **Practice / Vs computer** ("Always free").
- Row of 3–4 small tiles: Challenge / Leaders / Shop / Watch / Rules.

Street Dash (`/race`) differs: "Building the city…" boot, then a menu with Run (world picker, default Lagos), Ranked, Friends (race room), Missions, plus Events / Leaders / Shop / Watch (LIVE badge). Guest sees "Playing as guest · Save your progress" chip.

Game over ("Crashed!"): distance, NEW BEST pill, Coins / Best / Wallet trio, "Revive · 150 coins" (green, disabled when broke), "Play again" (gold), name field to join the leaderboard, WhatsApp button with a pre-filled brag + link, native "Share…", "Main menu".

Social panel (tabs): Race room (create / join 5-char code, copy, WhatsApp, world/mode/class/weather chips, chat, ready/start/rematch), Ranked (classes, find match, searching spinner, top racers), Watch (live list, join by code), Friends (friend code, requests, list).

---

## 6. Backend surface (observed in bundles, not executed)

Origin `https://gamesever.loodit.com`.

```
POST /api/auth/guest            POST /api/auth/otp/request   POST /api/auth/otp/verify
GET  /api/me  /api/me/photo     GET  /api/config             GET  /api/progress  /api/progress/rules
POST /api/daily/claim           POST /api/wallet/import      POST /api/wallet/purchase
POST /api/share                 GET  /api/ranked/me          GET  /api/garage  POST /api/garage/repair
POST /api/runs/start            POST /api/runs/:id/progress  POST /api/runs/:id/shop  POST /api/runs/:id/revive
GET  /api/friends  POST /api/friends/request  POST /api/friends/:id/accept|decline  DELETE /api/friends/:id
GET  /api/bowling/me /api/bowling/info  POST /api/bowling/challenge /api/bowling/challenge/throw
GET  /api/darts/me  /api/darts/info
socket.io namespaces: /rt (dash)  /tables (whot)  /bowl  /darts   events seen: session:ready, *:leave
```

Progression rules are fetched (`/api/progress/rules`), not hard-coded: per-game XP caps ("Up to N XP a run"), level-up coin payouts, daily table. Claim returns `{coins, daily, level, xp.levelUps[]}` and the hub animates wallet → daily → level → level-up modal in sequence (750 ms / 1300 ms delays).

---

## 6b. How the 3D games are built (Street Dash, observed)

Three.js r187, loaded as one 637 KB core chunk, plus a 503 KB game chunk. No game engine, no React Three Fiber, no physics library.

**Environment is procedural, not modelled.** The city, road, kerbs, sidewalks, buildings, skyline, palms, trees, stalls, lamps, bridges and props are all built in code from a small geometry registry (`box`, `cyl`, `hex`, `sphere`, `ico`, `pyramid`, `cone`, `coin`, `torus`, `RoundedBoxGeometry`) with a cached flat-shaded `MeshStandardMaterial` per colour. Textures that exist are generated at runtime on a `<canvas>` (palm bark stripes, tree bark, leaf blobs, building window grids/strips with an emissive map for night glow). Nothing in the environment is a downloaded model.

**Everything is data-driven by a world theme.** Each world (Lagos Streets, Neon City, Campus, Market, Beach Road, Harbour Docks, Owambe Street, Lagoon Bridge, Safari Road, Rainforest Road) is one object: ground/road/kerb colours, building style (`house`, setback, window style, min/max height, palette, roof colours, tower chance), skyline palette and heights, props (`street` lights, `["palm","palm","tree"]`, people count), foliage and trunk colours, stall colours, obstacle sets, traffic mix, zone names, and a music recipe (bpm, root, scale). Three time-of-day presets (day, sunset, night) each define sky top/bottom gradient, fog colour, sun colour and intensity, hemisphere sky/ground colours, sun disc position and size, cloud tint, stars, and window glow. Seasonal events (Festive, Harmattan Haze, Summer) layer decor on top.

**Lighting and look.** One `DirectionalLight` sun with shadows, one `HemisphereLight`, `RoomEnvironment` through `PMREMGenerator` for soft reflections, linear fog to `fogFar`, a gradient sky dome with a sun disc, clouds, stars at night. Flat shading plus fog is what gives it the clean low-poly look. Quality presets: low (dpr 1, no shadows, no peds), medium (dpr 1.5, 1024 shadow map, 8 peds), high (dpr 2, 2048 shadow map, 18 peds). In-app browsers (WhatsApp, Instagram, TikTok, Facebook) are detected by user agent and dropped to a lower preset.

**Only three things are real models, all GLB with meshopt compression via glTF-Transform 4.5.1:**

| Asset | Files | Notes |
|---|---|---|
| Traffic | `/traffic/car_0..4.glb` (~160 KB each), `bus.glb` (200 KB, webp texture, "citi_bus_mini"), `boxtruck.glb` | Purchased/stock low-poly vehicle packs (node names like `body04`, `jig_chrome`, `wheel_FL04`). Wheels are found by name `wheel_N` and spun in code |
| Player rides | `/cars/hatch.glb` (517 KB), `/cars/saloon.glb` | Same pack family, 8 materials, no textures |
| Characters | `/characters/chNN/character.glb` (675 KB) + `lod.glb` (334 KB), 7 runners (Tunde, Zara, …) | Mixamo-rigged humanoids (`mixamorig` bones), webp textures. Animations are separate skeleton-only GLBs in `/characters/anims/` (run, jump, slide, trip, idle×3, walk×2, wave×2, talk, phone×2, text×2, argue×2, laugh, sit, sweep, pacing, drink, turn) exported with THREE.GLTFExporter from Mixamo FBX, retargeted at runtime by renaming `mixamorigN` bones. Same clips drive the crowd via `InstancedMesh` + `AnimationMixer` |
| Animals | `/models/animals/cow.glb` (1.6 MB) | Blender Rigify rig (`DEF-spine.*`), 5 clips, safari world only |

A `manifest.json` lists runners, animations and crowd animations so new characters can be added without a rebuild. Loading shows a progress ring fed by per-file `onProgress`.

**Bowling / Darts / Whot** reuse the same approach: `lane3d`, `board3d`, `table3d` chunks build the venue from primitives with neon emissive materials; `lane-sim` (227 KB) is a hand-written ball/pin simulation, not a physics library.

**What to take from this for GameArena's `/world`:** the look comes from flat-shaded primitives + a strict per-world palette + fog + one warm sun + emissive windows at night, not from asset quality. Spend on a theme data file and a canvas-texture helper, buy one low-poly vehicle pack and a few Mixamo characters, and compress everything with glTF-Transform meshopt.

---

## 7. Where GameArena already is vs. DashExpo

| Area | GameArena today (gamearenahq.xyz, branch dev) | DashExpo | Gap |
|---|---|---|---|
| Framework | Next.js 15, inline styles, `--ga-*` tokens | Vanilla + Vite | Keep Next. Port the look, not the stack |
| Auth | Wallet-first (Privy), no email | Guest-first, email OTP to save | Big UX gap: DashExpo plays in 0 taps |
| Hub | `/games` grid of 4 cards (Rhythm, Simon, Stack, Challenge AI) + `/dashboard` + bottom nav | Single hub: profile, daily, today, hero + grid | We split what they put on one screen |
| Progression | XP, levels, pet stages, 13 achievements, 3 daily missions, streaks | XP, levels that pay coins, 7-day daily grid, quests with tries | We have the engine, not the presentation |
| Economy | G$ wagers, habitats, on-chain scores | Coins won not bought, revive cost, entry-fee selector | Our coins are real (G$). Entry fee selector maps to wagers |
| Realtime | Duel rooms spec in `docs/duel-rooms`, PvP arena | Rooms with 5-char code + WhatsApp, ranked rating, spectate, voice | Rooms + WhatsApp share are the viral loop we lack |
| Games | 2D canvas/DOM games | Three.js 3D games | Out of scope for a hub pass |
| Share | Profile card | Pre-filled WhatsApp brag after every game | Cheap, high leverage |

---

## 8. Recommendation for `explore/next-build`

Build in this order. Each step ships on its own.

1. **Hub rebuild** (the "exactly how I want it" part). Replace `/games` + `/dashboard` with one DashExpo-style hub: top bar with G$ wallet pill, profile card with ring + level + "Level N pays +X", 7-day daily reward grid wired to the existing streak/mission engine, "Today" row from existing daily missions, hero + 2-column game cards with looping video covers and the glass dock. Fredoka + Inter Tight, the token set in §3, sticky-stack cards on mobile.
2. **Guest-first play.** Let a visitor play any game before connecting a wallet. Keep "Verify to earn" for payouts (this matches the existing "Play first. Verify to earn." rule). Privy already supports guest/embedded flows.
3. **Per-game lobby.** One shared lobby component: hero mode tile with an Entry selector (Free / G$ amounts → existing wager contract), Ranked / Friends / Practice tiles, Leaders / Shop / Watch row.
4. **Rooms + WhatsApp.** Room codes on top of the duel-rooms spec, WhatsApp brag button on every game-over screen with a pre-filled link.
5. Later: ranked rating ladder (Bronze 1000 → Legend), spectate, 3D.

Do not copy: their backend (Loodit), their assets, their copy. Copy the information architecture, the token system, the motion rules, and the economy loop.
