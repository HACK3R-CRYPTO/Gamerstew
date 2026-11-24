# GameArena · Frontend

This is the player-facing web app for GameArena, a mobile-first arcade on Celo. It is the thing users actually open: they log in, play skill games, submit scores on-chain, climb leaderboards, and manage their profile and wallet. Everything here runs against the Celo mainnet contracts and the separate games-backend service.

Built with Next.js 16 (App Router), React 19, wagmi v3, viem v2, and Privy for auth. Styling is inline theme objects plus Tailwind v4. The app is designed for phones first and runs both as a standalone web app and as a MiniPay Mini App.

## Running locally

```bash
npm run dev
```

Open http://localhost:3000 (or pass `-p 3001`).

A running games-backend (default `http://localhost:3005`) is required for score signing, submission, leaderboards, and the Challenge AI arena. See the env vars below.

### Environment

Public (bundled into the browser):

- `NEXT_PUBLIC_PRIVY_APP_ID` · Privy auth
- `NEXT_PUBLIC_BACKEND_URL` · client-side backend base for a few direct reads
- Optional overrides for contract addresses (`NEXT_PUBLIC_AI_AGENT_ADDRESS`, `NEXT_PUBLIC_ERC8004_*`, `NEXT_PUBLIC_HABITAT_REGISTRY`, `NEXT_PUBLIC_PERK_SHOP`, `NEXT_PUBLIC_SOLO_WAGER_ADDRESS`, `NEXT_PUBLIC_AGENT_TOKEN_ID`)

Server-only (never prefixed with `NEXT_PUBLIC_`, so they never reach the browser):

- `PRIVY_APP_SECRET` · verifies Privy access tokens server-side
- `BACKEND_URL` · games-backend base used by server actions
- `INTERNAL_SECRET` · shared secret sent as `x-internal-secret` on every backend call

## Auth and wallet

Auth is Privy. Login methods are Google, email, and external wallet. Every user gets a Privy embedded wallet (`createOnLogin: 'all-users'`). Wagmi is wired through `@privy-io/wagmi`, chain is Celo mainnet only (42220), with a multi-RPC fallback (Forno · Ankr · 1rpc · default) so one bad node does not stall the app. Providers are assembled in `components/providers.tsx`.

MiniPay is a first-class second path. `components/MiniPayConnector.tsx` auto-connects the injected MiniPay wallet, and `hooks/useMiniPay.ts` exposes `useIsMiniPay`. MiniPay users have no Privy JWT and cannot `personal_sign` or sign typed data, so the flows branch: identity is enforced by the on-chain tx itself instead of a client signature. MiniPay users also hold zero CELO by design, so transactions pass a `feeCurrency` fee-currency adapter. `lib/contracts.ts` holds the stablecoin token and adapter addresses and `detectFeeSpread`, which reads the user's USDT/USDC balances over a direct Forno RPC call and picks the best fee token, falling back to USDm.

Session handling is explicit, not automatic. There is no background auto-logout. A half-dead session (Privy authed, wallet disconnected) is shown honestly on `/connect` with a log-out button.

## Routes

Pages live under `app/`. The ones players reach from the app:

- `/` · the opening splash; it goes to `/dashboard` after about a second
- `/dashboard` · the home hub: the 3D and 2D game shelves, daily missions, the weekly community challenge, live activity
- `/home` · sign-in
- `/games/stack`, `/games/ladder`, `/games/simon`, `/games/rhythm` · Stack Tower, Word Ladder, Simon Memory, Rhythm Rush
- `/bowling` · Street Strike (3D, react-three-fiber + Rapier)
- `/world` · UP NEPA 3D (3D, react-three-fiber): Restore the Light, Charge Rush and Free Roam
- `/games/challenge-ai` · Challenge AI (MARKOV) Instant Arena, with a YOU / YOUR AI switch
- `/agents` · deploy and watch your own GoodAgents agent
- `/leaderboard` · Ranks: this week per game, events, past seasons, all-time
- `/games/<game>/leaderboard`, `/bowling/leaderboard`, `/world/leaderboard` · per-game boards
- `/profile` · pet, habitats, best scores for every game, achievements grouped by game
- `/pass/[address]` · the public passport (username or 0x): rank, best score in every game, badges, pet, lifetime UBI, share and referral
- `/shop` · perks and cosmetics paid in G$
- `/settings`, `/verify`, `/mint`, `/connect`, `/privacy`, `/terms`

Older or special-purpose routes that still exist:

- `/duel`, `/duel/create`, `/duel/[id]` · Friend Duels on the `DuelEscrow` contract. Superseded by friend rooms (below); not promoted in the app. The contract has known issues, see `docs/` and the main README
- `/games/nepa` · the first, 2D UP NEPA. No longer linked from home
- `/games/survivor` · Slime Survivor, an unfinished experiment reachable by direct link
- `/games` · the earlier games lobby
- `/tug` · Tug of War, a team event that ended on 30 September 2026
- `/sprint` (invite-only), `/creator-contest`, `/vote`, `/impact`, `/pitch`, `/leaderboard/cup`, `/leaderboard/solo-ladder` · event and campaign pages
- `/animtest` · animation diagnostics for a problem device
- `/dev-preview` · development only (not found in a production build): a place to look at pop-ups that normally need a level-up to appear

Server actions live in `app/actions/` (`game.ts`, `arena.ts`, `missions.ts`, `perks.ts`, `gas.ts`, `habitat.ts`, `push.ts`, `goodagents.ts` for the partner API bridge, `collective.ts` for the GoodCollective choice). Route handlers live in `app/api/` (season, markov-climb, pvp-leaderboard, match-outcome, cup, duel, tug, payouts, impact-stats, verified-stats, achievements, badges, user, sprint, push, referrals, a2a for MARKOV's agent-to-agent surface, and `ref/resolve` + `ref/count` for username referral codes).

## The games

Six skill games plus Challenge AI. All are free to play without a wallet. No game starts by itself: each opens on a start screen and waits for the player.

| Game | Route | On-chain id | How the score is checked |
|---|---|---|---|
| Rhythm Rush | `/games/rhythm` | 0 | The server replays the tap log against the song |
| Simon Memory | `/games/simon` | 1 | The server replays the taps against the pattern it dealt |
| Stack Tower | `/games/stack` | 2 | Bounded by the drop log and a humanness check |
| Challenge AI | `/games/challenge-ai` | 3 | Played on the server, commit-reveal |
| Word Ladder | `/games/ladder` | 5 | The server dealt the puzzles and replays the moves |
| Street Strike | `/bowling` | 6 | The server replays every throw through the same physics |
| UP NEPA 3D | `/world` | 7 | Restore the Light only: the server's clock sets the time and bounds the rest. Charge Rush is not ranked |

(Id 4 is the retired 2D UP NEPA.) The 2D games share `components/GameLobby.tsx` (start screen), `components/GameResult.tsx` (result screen) and `components/RunSaveStatus.tsx` + `components/TxStatus.tsx`, which wait for the transaction's receipt and say confirming, confirmed or failed.

The 3D games lazy-load three.js so it only downloads on their routes. `/world` picks a quality tier per device (`app/world/quality.ts`); `?q=low|mid|high` forces one. Its Charge-mode props are small GLB files built by `tools/blender/build_devices.py`, run with Blender from the terminal.

Challenge AI is MARKOV, the "Instant Arena": free, best-of-5 Rock-Paper-Scissors, first to 3. It runs through server actions in `app/actions/arena.ts` with a commit-reveal scheme for fairness.

## Friend rooms

Every skill game has a "Play with friends" button (`components/FriendsPlay.tsx`, `components/FriendsSheet.tsx`, `hooks/useFriendRoom.ts`). One player opens a room and shares the code or link; up to four play the same round at once. The phone asks the server for the room about once a second, so there is no socket to drop.

The browser talks to `app/api/rooms/[...path]/route.ts`, which talks to the backend with the internal secret. That route also decides which wallet a seat plays as: it checks the Privy sign-in against the claimed wallet (`lib/server/roomWallet.ts`) and ignores any wallet sent in the request body. A signed-in player's round in a server-checked game is recorded on-chain, and the standings show the transaction.

Rooms in server-checked games can be played for a G$ entry when the backend allows it. The player signs a G$ permit (`hooks/useRoomPermit.ts`); nothing is held, and each loser's entry goes straight to the winner at the end.

## Notifications

The bell opens an inbox kept on the server (`components/NotificationsSheet.tsx`): read state follows the player across devices, items can be deleted, and announcements from GameArena have their own tab. Web push is optional and separate.

## Look

One theme, Lilac: a light lavender page, deep purple ink (`#22104f`), a purple primary button, Melon Pop for display text. Screens are inline-styled; there is no component library.

## The public Passport

`/pass/[address]` is a shareable public page for every player. The URL takes a username or a `0x` address; `resolvePassHandle` maps a username to its wallet. The page is server-rendered (so crawlers see real data) with a per-player OG image (`opengraph-image.tsx`). It shows identity, rank, best scores, badges, pet in its habitat, and lifetime UBI contribution, assembled best-effort in `lib/passport.ts` so a dead RPC or backend renders fewer stats rather than a 404.

The verified badge is computed on-chain at render time: `getWhitelistedRoot` on the GoodDollar Identity contract (resolving linked wallets) decides it, not whether the player holds a GamePass. A whitelisted wallet gets a `VERIFIED HUMAN` badge; a minted-but-unverified wallet gets a neutral `GAMEPASS` badge instead. Every outbound CTA carries `?ref={address}`, so the passport doubles as the referral engine and usernames act as referral codes.

## GoodAgents

`/agents` is the GoodAgents partnership surface: players deploy their own AI agent, verify it through GoodDollar (face scan plus a G$ bond), and monitor it, all inside an embedded GoodAgents widget (`components/AgentsWidget.tsx`, loaded client-only) that talks to goodagentids.xyz under the `gamearena` partner id. Owners see their deployed agent (identity, daily match usage, send-in CTA); newcomers get the deploy widget in onboard mode, face verification first, rethemed to GameArena tokens. The deployed agent then plays MARKOV from the `YOUR AI` mode of the Challenge AI lobby. `app/actions/goodagents.ts` is the server-to-server bridge: the partner key never reaches the browser, and write calls carry the player's own EIP-191 wallet signature so the host can verify the owner authorised the action. (Note: `Square`/worldstreet is a separate external app that consumes our backend partner API; it is not part of this frontend. GoodAgents is this frontend's own partner surface.)

## Perks and cosmetics

The `/shop` sells in-game perks paid in G$ through the `PERK_SHOP` contract: saves and retries, Challenge AI match tickets, and cosmetics. Buys support a gasless EIP-2612 permit path (`app/actions/perks.ts`, `lib/perks.ts`) so a player with zero CELO signs once and a relayer submits. Cosmetics are owned forever on-chain: Crystal Blocks (a Stack Tower skin) and Neon Trail (a Rhythm Rush skin) apply in-game, gated by an equip toggle whose state syncs to the backend keyed by wallet, so an owned skin can be turned on or off across devices.

## Score submission

1. `startGame` issues a single-use session ticket when the player taps play. Privy users are checked with their access token; MiniPay users pass their address.
2. `signScore` sends the run (tap log, moves, drops) to the backend, which works out the score it will accept and records it on-chain itself, gasless. The reply carries the transaction hash. If the gasless budget is used up it returns a signed EIP-712 voucher instead, and the player's wallet calls `recordScoreWithBackendSig`.
3. `submitScore` saves the result (activity, XP, missions, achievements) and returns rank, streak and personal best. A run is saved once; if the phone never makes this call, a backend job finishes the save from the recorded transaction.

Every action has a `...MiniPay` variant without the Privy token. All server actions reach the backend through a helper that attaches `INTERNAL_SECRET`, so that secret and `BACKEND_URL` never reach the browser.

## Local development against live data

`.env.local` can point `NEXT_PUBLIC_BACKEND_URL` at `/api/dev-live`, a development-only route that passes GET requests through to the live backend. It lets pages be looked at with real data without running a backend. It is read-only and does not exist in a production build.

## Vote flow

`/vote` helps GoodDollar-verified players vote for GameArena on Flow State (the GoodBuilders funding platform). A player's verified address is a Privy embedded wallet scoped to this app, and Flow State mints a different address on its own login, so the page walks Privy users through exporting the verified key into a standalone wallet using Privy's secure export modal, then connecting that wallet to Flow State. MiniPay users already hold a standalone wallet and skip the export step.

## Contracts

Addresses and ABIs are in `lib/contracts.ts` (and `lib/abis/`). Celo mainnet:

- `ARENA_PLATFORM` · PvP match contract
- `GAME_PASS` · username NFT plus on-chain score recording (`recordScoreWithBackendSig`, `bestScore`, `weeklyBest`, seasons)
- `G_TOKEN` · GoodDollar (G$)
- `SOLO_WAGER` · optional G$ ranked entry for solo runs
- `HABITAT_REGISTRY` · habitats
- `PERK_SHOP` · in-game perks paid in G$ (saves, retries, cosmetics, Challenge AI match tickets); gasless buys via EIP-2612 permit
- `DUEL_ESCROW` · money layer of the older Friend Duels (`lib/duel.ts`). Not used by friend rooms
- `ERC8004_REGISTRY` / `ERC8004_REPUTATION` · MARKOV's on-chain agent identity (agent #6386) and reputation

## Layout

- `app/` · routes, server actions, API route handlers
- `components/` · shared UI (headers, nav, sheets, onboarding, toasts, game-specific canvases)
- `lib/` · contracts, wagmi config, board and subgraph reads, achievements, pets, habitats, share cards, duel escrow, passport assembly, GoodCollectives, referral, helpers
- `hooks/` · MiniPay, auth gating, gas status, audio, habitats, push notifications, friend rooms
- `tools/blender/` · scripts that build 3D props
- `contexts/` · `SelfVerificationContext` for GoodDollar verification state

## Note on Next.js

This app targets Next.js 16, which has breaking changes from earlier versions. Check `node_modules/next/dist/docs/` and heed deprecation notices before writing new code (see `AGENTS.md`).
