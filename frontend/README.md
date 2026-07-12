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
- Optional overrides for contract addresses (`NEXT_PUBLIC_AI_AGENT_ADDRESS`, `NEXT_PUBLIC_ERC8004_*`, `NEXT_PUBLIC_HABITAT_REGISTRY`, `NEXT_PUBLIC_SOLO_WAGER_ADDRESS`, `NEXT_PUBLIC_AGENT_TOKEN_ID`)

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
- `/games/challenge-ai` · Challenge AI (MARKOV) Instant Arena
- `/games/survivor` · Slime Survivor, an in-progress route currently hidden from the lobby but reachable by direct link
- `/games/<game>/leaderboard` · per-game leaderboards
- `/leaderboard` and `/leaderboard/solo-ladder` · global and solo-ladder standings
- `/dashboard` · player stats
- `/profile` · profile, pet, habitats
- `/mint` · mint the GamePass (username NFT)
- `/verify` · GoodDollar citizenship verification
- `/vote` · walkthrough for casting a verified community vote on Flow State
- `/shop` · shop
- `/settings` · settings
- `/pitch`, `/privacy`, `/terms` · static content

Server actions live in `app/actions/` (`game.ts`, `arena.ts`, `missions.ts`, `gas.ts`). Route handlers live in `app/api/` (season join/leaderboard/intent, markov-climb, pvp-leaderboard, match-outcome, a2a).

## The games

Solo games (three): Rhythm Rush, Simon Memory, Stack Tower. Each is a single canvas game loop driven by `requestAnimationFrame`, with React handling only HUD and screens. All three are free to play without a wallet, and connected players can submit scores on-chain.

Challenge AI is MARKOV v3, the "Instant Arena". It is free, best-of-5 rounds, first to 3 wins. MARKOV plays Rock-Paper-Scissors and Coin Flip only. It runs entirely through server actions in `app/actions/arena.ts` against the backend `/api/arena/*` endpoints, using a commit-reveal scheme for fairness: the match starts with a `commitHash`, each throw returns the round outcome and MARKOV's read on the player, and the final payload reveals the seed and the model. There is a daily match limit with an optional G$ refill, including a gasless EIP-2612 permit path so a player with zero CELO can still buy more.

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
- `ERC8004_REGISTRY` / `ERC8004_REPUTATION` · MARKOV's on-chain agent identity and reputation

## Layout

- `app/` · routes, server actions, API route handlers
- `components/` · shared UI (headers, nav, sheets, onboarding, toasts, game-specific canvases)
- `lib/` · contracts, wagmi config, subgraph reads, achievements, pets, habitats, share cards, helpers
- `hooks/` · MiniPay, auth gating, gas status, audio, habitats, push notifications
- `contexts/` · `SelfVerificationContext` for GoodDollar verification state

## Note on Next.js

This app targets Next.js 16, which has breaking changes from earlier versions. Check `node_modules/next/dist/docs/` and heed deprecation notices before writing new code (see `AGENTS.md`).
