# GameArena · Frontend

This is the player-facing web app for GameArena, a mobile-first arcade on Celo. It is the thing users actually open: they log in, play skill games, submit scores on-chain, climb leaderboards, and manage their profile and wallet. Everything here runs against the Celo mainnet contracts and the separate games-backend service.

Built with Next.js 16 (App Router), React 19, wagmi v3, viem v2, and Privy for auth. Styling is inline theme objects plus Tailwind v4. The app is designed for phones first and runs both as a standalone web app and as a MiniPay Mini App.

## Running locally

```bash
npm run dev
```

Open http://localhost:3000.

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

Pages live under `app/`. Key routes:

- `/` and `/home` · landing and the main logged-in home hub
- `/connect` · login and wallet connection
- `/games` · game lobby (the solo game cards plus the Challenge AI card)
- `/games/rhythm` · Rhythm Rush
- `/games/simon` · Simon Memory
- `/games/stack` · Stack Tower
- `/games/challenge-ai` · Challenge AI (MARKOV) Instant Arena · YOU / YOUR AI lobby switch: play MARKOV yourself, or send your deployed GoodAgents agent in and watch the match live (SSE stage with win dots, read meter, staged clashes)
- `/agents` · agent home: owners see their deployed agent (identity, daily match usage, send-in CTA); newcomers get the embedded GoodAgents deploy widget (onboard mode, face verification first, rethemed to GameArena tokens)
- `/pass/[address]` · public player passport (username or 0x in the URL) · rank, scores, badges, pet + habitat, lifetime UBI, per-player OG card, share/save with `?ref=` referral codes
- `/games/survivor` · Slime Survivor, an experimental in-progress route hidden from the lobby but reachable by direct link
- `/games/<game>/leaderboard` · per-game leaderboards
- `/leaderboard` · the events hub, with LIVE / PAST / ALL-TIME tabs (3-Week Cup, current and past weekly seasons, community challenge, MARKOV Climb, Team Wars + Solo Ladder, and the cross-game all-time combined ladder from the subgraph)
- `/leaderboard/solo-ladder` and `/leaderboard/cup` · the solo ladder and the 3-Week Cup standings
- `/duel` · Friend Duels: the Rooms hub for creating and joining on-chain G$ challenge rooms and prize pools (DuelEscrow)
- `/duel/create` and `/duel/[id]` · create a room, and a single room's lobby/scoreboard
- `/tug` · Tug of War, a verified-humans team event (two sides pull one rope over a week, per-player bounty slots, recruiter pools). This event has now ended
- `/impact` · the G$ economy page: live players/games/UBI from the subgraph, framed as demo-day epochs
- `/dashboard` · player stats
- `/profile` · profile, pet, habitats
- `/mint` · mint the GamePass (username NFT)
- `/verify` · GoodDollar citizenship verification
- `/vote` · walkthrough for casting a verified community vote on Flow State
- `/shop` · shop
- `/settings` · settings (includes the GoodCollective picker)
- `/sprint` · an invite-only private sprint room
- `/creator-contest` · a referral leaderboard for the creator/thread contest window
- `/pitch`, `/privacy`, `/terms` · static content

Server actions live in `app/actions/` (`game.ts`, `arena.ts`, `missions.ts`, `perks.ts`, `gas.ts`, `habitat.ts`, `push.ts`, `goodagents.ts` for the partner API bridge, `collective.ts` for the GoodCollective choice). Route handlers live in `app/api/` (season, markov-climb, pvp-leaderboard, match-outcome, cup, duel, tug, payouts, impact-stats, verified-stats, achievements, badges, user, sprint, push, referrals, a2a for MARKOV's agent-to-agent surface, and `ref/resolve` + `ref/count` for username referral codes).

## The games

Solo games (three): Rhythm Rush, Simon Memory, Stack Tower. Each is a single canvas game loop driven by `requestAnimationFrame`, with React handling only HUD and screens. All three are free to play without a wallet, and all three submit scores on-chain (GamePass `recordScoreWithBackendSig`, `gameType` 0/1/2) to their own ranked weekly leaderboards once you sign in. Each game has server-side score validation (`computeStackScore`/humanness checks for Stack, replay/jitter checks for Rhythm).

Slime Survivor (`app/games/survivor`) is an experimental fourth solo game. The route and its game code work by direct link, but the card is commented out of the games lobby, so it is effectively hidden from players for now.

Challenge AI is MARKOV, the "Instant Arena". It is free, best-of-5 rounds, first to 3 wins. MARKOV plays Rock-Paper-Scissors only (the old Coin Flip mode is retired). It runs entirely through server actions in `app/actions/arena.ts` against the backend `/api/arena/*` endpoints, using a commit-reveal scheme for fairness: the match starts with a `commitHash`, each throw returns the round outcome and MARKOV's read on the player, and the final payload reveals the seed and the model. MARKOV also has a rank-aware voice (`hooks/useMarkovVoice.ts`): it speaks its taunts aloud at the moments that matter, opening on a line tuned to the player's rank and tier, reacting to reads and streaks and sudden death, and closing on the match line. There is a daily match limit with an optional G$ refill, including a gasless EIP-2612 permit path so a player with zero CELO can still buy more. MARKOV carries an on-chain ERC-8004 agent identity (agent #6386).

The `/games/challenge-ai` lobby has two modes on one segmented switch: YOU (you throw the moves yourself) and YOUR AI (you send in the agent you deployed on `/agents` and watch the match play out live over an SSE stage with win dots, a read meter, and staged clashes).

## Friend Duels

`/duel` is the Rooms hub for on-chain challenge rooms. A player creates a room (`/duel/create`) with a game, a stake or a seeded prize, a capacity, and a deadline; others join and play; the winner takes the pot. The money layer is the `DuelEscrow` contract (`lib/duel.ts`): reads come from a fast backend mirror that filters private rooms, and writes go straight to the contract from the player's wallet, with an EIP-2612 permit path that skips the separate approve. Rooms can be public or private (join by code or allowlist), and a seeded, zero-stake room reads as a prize pool.

## Tug of War

`/tug` was a week-long verified-humans team event: two sides pull one rope, and every verified human a player recruits onto their side pulls for them. It layered a per-player bounty (first-come guaranteed G$ slots, kept even if your side loses), a daily winnable tick so the trailing side always has something live to fight for, and recruiter prize pools. Standings come from the backend (`app/api/tug`). The event has now ended and its G$ prize pool was paid out on-chain; the UI (`app/tug`, `components/TugRope.tsx`, `TugRules.tsx`, `TugTeaser.tsx`) hides itself once the window closes.

## The public Passport

`/pass/[address]` is a shareable public page for every player. The URL takes a username or a `0x` address; `resolvePassHandle` maps a username to its wallet. The page is server-rendered (so crawlers see real data) with a per-player OG image (`opengraph-image.tsx`). It shows identity, rank, best scores, badges, pet in its habitat, and lifetime UBI contribution, assembled best-effort in `lib/passport.ts` so a dead RPC or backend renders fewer stats rather than a 404.

The verified badge is computed on-chain at render time: `getWhitelistedRoot` on the GoodDollar Identity contract (resolving linked wallets) decides it, not whether the player holds a GamePass. A whitelisted wallet gets a `VERIFIED HUMAN` badge; a minted-but-unverified wallet gets a neutral `GAMEPASS` badge instead. Every outbound CTA carries `?ref={address}`, so the passport doubles as the referral engine and usernames act as referral codes.

## GoodAgents

`/agents` is the GoodAgents partnership surface: players deploy their own AI agent, verify it through GoodDollar (face scan plus a G$ bond), and monitor it, all inside an embedded GoodAgents widget (`components/AgentsWidget.tsx`, loaded client-only) that talks to goodagentids.xyz under the `gamearena` partner id. Owners see their deployed agent (identity, daily match usage, send-in CTA); newcomers get the deploy widget in onboard mode, face verification first, rethemed to GameArena tokens. The deployed agent then plays MARKOV from the `YOUR AI` mode of the Challenge AI lobby. `app/actions/goodagents.ts` is the server-to-server bridge: the partner key never reaches the browser, and write calls carry the player's own EIP-191 wallet signature so the host can verify the owner authorised the action. (Note: `Square`/worldstreet is a separate external app that consumes our backend partner API; it is not part of this frontend. GoodAgents is this frontend's own partner surface.)

## Perks and cosmetics

The `/shop` sells in-game perks paid in G$ through the `PERK_SHOP` contract: saves and retries, Challenge AI match tickets, and cosmetics. Buys support a gasless EIP-2612 permit path (`app/actions/perks.ts`, `lib/perks.ts`) so a player with zero CELO signs once and a relayer submits. Cosmetics are owned forever on-chain: Crystal Blocks (a Stack Tower skin) and Neon Trail (a Rhythm Rush skin) apply in-game, gated by an equip toggle whose state syncs to the backend keyed by wallet, so an owned skin can be turned on or off across devices.

## Score submission (voucher flow)

Solo scores are bound on-chain through an EIP-712 voucher so the leaderboard cannot be faked:

1. `startGame` issues a single-use server session token when the player taps play. Privy users authenticate with their access token; MiniPay users pass just their address.
2. `signScore` returns a signed `BackendApproval` voucher (`signature`, `nonce`, `gameType`). For Rhythm, the client sends its full tap log and the server replays it to compute the canonical score, so the client never claims a raw number.
3. The player's wallet calls `recordScoreWithBackendSig` on the GamePass contract, passing the voucher.
4. `submitScore` records the result off-chain (Supabase via the backend), awards XP, updates missions, and returns rank, streak, personal-best, and any new achievements.

Every action has a `...MiniPay` variant that drops the Privy JWT and client-signature checks, since MiniPay forbids those signatures and the on-chain tx already binds the score to the wallet. All server actions proxy the backend through a helper that attaches `INTERNAL_SECRET`, so that secret and `BACKEND_URL` never reach the browser. The voucher signing types are in `app/actions/game.ts`.

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
- `DUEL_ESCROW` · on-chain money layer for Friend Duel rooms and prize pools (`lib/duel.ts`)
- `ERC8004_REGISTRY` / `ERC8004_REPUTATION` · MARKOV's on-chain agent identity (agent #6386) and reputation

## Layout

- `app/` · routes, server actions, API route handlers
- `components/` · shared UI (headers, nav, sheets, onboarding, toasts, game-specific canvases)
- `lib/` · contracts, wagmi config, subgraph reads, achievements, pets, habitats, share cards, duel escrow, passport assembly, GoodCollectives, referral, helpers
- `hooks/` · MiniPay, auth gating, gas status, audio, habitats, push notifications
- `contexts/` · `SelfVerificationContext` for GoodDollar verification state

## Note on Next.js

This app targets Next.js 16, which has breaking changes from earlier versions. Check `node_modules/next/dist/docs/` and heed deprecation notices before writing new code (see `AGENTS.md`).
