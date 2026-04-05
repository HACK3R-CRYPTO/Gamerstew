# GameArena — Frontend

Next.js 15 app for GameArena — a competitive gaming platform on Celo Mainnet powered by GoodDollar G$.

## Stack

- **Next.js 15** (App Router, Server Actions)
- **Privy** — wallet connect + auth
- **wagmi / viem** — on-chain reads/writes
- **Supabase** — score data (via server actions only)
- **GoodDollar Identity SDK** — Sybil-resistant verification

## Quick Start

```bash
npm install
npm run dev       # http://localhost:3000
```

## Environment Variables

Create a `.env.local` file:

```bash
# Privy
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Backend
NEXT_PUBLIC_BACKEND_URL=http://localhost:3005
BACKEND_URL=http://localhost:3005
INTERNAL_SECRET=

# Supabase (fallback only — backend is primary)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Contracts (Celo Mainnet)
NEXT_PUBLIC_ARENA_PLATFORM_ADDRESS=0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE
NEXT_PUBLIC_SOLO_WAGER_ADDRESS=0xc78A8A027e07Ae5d52981f627bbac973a8d77eFb
NEXT_PUBLIC_GAME_PASS_ADDRESS=0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE
NEXT_PUBLIC_G_TOKEN_ADDRESS=0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A
```

## Pages

| Route | Description |
|---|---|
| `/` | Home — game cards, wager, FAQ, onboarding |
| `/games/rhythm` | Rhythm Rush — tap to the beat |
| `/games/simon` | Simon Memory — repeat color sequences |
| `/games/arena` | Arena — challenge Markov-1 AI |
| `/leaderboard` | Rankings, seasons, PvP history |

## Key Architecture

- **Server Actions** (`app/actions/game.ts`) — score submission runs server-side. `PRIVY_APP_SECRET` and `INTERNAL_SECRET` never reach the browser.
- **Score flow**: Browser → Next.js Server Action → Express backend → Supabase + on-chain tx
- **Security**: `INTERNAL_SECRET` header on all backend calls. Backend fails to start if secret is missing.

## Build

```bash
npm run build
npm start
```
