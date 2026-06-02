# games-backend

Express + Supabase service that powers the off-chain side of GameArena · score submission, leaderboards, seasons, missions, achievements, push notifications, anti-cheat session validation, and a handful of admin/maintenance routes. The frontend reads from here; the agent writes to Supabase directly for match state.

Production deploy: Railway · `https://game-backend-production-6130.up.railway.app`

---

## What it does

- **Score pipeline** · session-bound score submission gated by EIP-712 vouchers signed by the validator key. Anti-cheat checks reject impossible-duration sessions, double-fired submissions, and tampered vouchers.
- **Leaderboards** · weekly per-game, all-time combined (Rhythm + Simon), Season 1 standings, PVP arena rankings (computed by the Next.js layer reading the same Supabase tables).
- **Seasons + cups** · weekly season auto-cut by epoch math, multi-week cumulative competitions, 72-hour Arena Cups, weekly community-games challenge, frozen-on-end winner snapshots.
- **Progression** · daily missions, milestone achievements, XP / level math, play streaks, mission claims.
- **Identity** · username resolution from the GamePass NFT (LRU-cached `resolveUsername`).
- **Push notifications** · VAPID web push, opt-in subscriptions, broadcast endpoint, deep-link routing.
- **Habitat economy** · habitat ownership reads from on-chain (Goldsky subgraph), lazy purchase-credit sync into Season 1 points ledger.
- **Faucet** · gated G$ drip for first-time players (internal-secret guarded).
- **Health + observability** · `/health` endpoint returns Supabase + chain reachability for Railway uptime probes.

---

## Selected routes

| Route | Purpose |
|---|---|
| `POST /api/start-session` | Open a game session · returns the session id used by sign-score |
| `POST /api/sign-score` | EIP-712 sign a score voucher · internal-secret only |
| `POST /api/submit-score` | Submit a signed score voucher · validates + persists |
| `GET /api/leaderboard` | Weekly rankings per game |
| `GET /api/seasons` | Current season meta + countdown |
| `GET /api/competition` | Multi-week cumulative cup standings |
| `GET /api/weekly-challenge` | Community games milestone progress |
| `GET /api/badges/:address` | Tier badges + championship NFTs |
| `GET /api/missions/today/:address` | Daily missions + claim state |
| `GET /api/usernames?wallets=...` | Batch wallet → GamePass username resolution |
| `POST /api/push/subscribe` | Register a web-push endpoint |
| `POST /api/push/broadcast` | Broadcast to all subscribers · internal-secret only |
| `POST /api/competition/freeze` | Admin force-freeze the active competition |
| `POST /api/faucet` | First-time G$ drip · internal-secret + strict rate limit |
| `GET /health` | Liveness + readiness for Railway |

Several admin routes are gated by `INTERNAL_SECRET` headers · the frontend forwards the secret server-to-server so player wallets can't hit those paths directly.

---

## Storage

Postgres on Supabase. Tables and views are defined in `supabase-migrations/` and applied in order. The aggregate `supabase-migrations.sql` snapshots the same schema for one-shot import.

Selected tables:

- `activity` · single source of truth for every score submission
- `game_sessions` · session metadata, anti-cheat join keys
- `season_v1_meta` · active season window + prize pool config
- `season_v1_players` · team-join records
- `season_v1_points` · points ledger (game_played, wager_won, referral_qualified, active_day, etc.)
- `season_v1_results` · sealed past seasons with frozen standings + prize_winners JSONB
- `agent_match_state` · off-chain mirror of resolved matches, written by the agent
- `agent_loss_caps` · daily loss-cap accounting for MARKOV
- `push_subscriptions` · VAPID endpoints + opt-out state

---

## Configuration

| Key | Purpose |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Anon role · RLS off on `agent_*` and `season_v1_*` tables so anon has full access |
| `INTERNAL_SECRET` | Bearer used by the Next.js frontend to call protected routes |
| `VALIDATOR_PRIVATE_KEY` | EIP-712 signer for score vouchers |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web push key pair |
| `FORNO_RPC_URL` | Defaults to public Forno |
| `GAMEPASS_ADDRESS` | GamePass NFT contract for username resolution |
| `PLATFORM_ADDRESS` | ArenaPlatform for chain reads (subgraph fallback) |

---

## Running locally

```bash
cd games-backend
npm install
cp .env.example .env   # fill in keys
node server.js         # http://localhost:3005
```

The frontend reads `process.env.NEXT_PUBLIC_BACKEND_URL` (or `BACKEND_URL` server-side) to point at this host.

---

## Operational notes

- **`/api/sign-score` is the only path that mints fresh vouchers.** A session must exist (created via `/api/start-session`) and the signed payload binds wallet + session + game + score + timestamp. Vouchers are single-use.
- **Anti-cheat thresholds** live in `lib/rhythmScoring.js` and the inline checks in `submit-score`. Tuning either should ship with a migration test against existing scores.
- **Competition + season freeze** is driven by epoch math · the `freezeCompetitionIfNeeded` and `seal_season_v1` paths self-gate so a cold-started process still freezes correctly on the first GET after the deadline.
- **Push broadcast hits every active subscription.** `sent/skipped/cleaned` in the response telemetry shows how many subscribers received the push and how many stale endpoints were pruned.
- **Don't mix `agent_match_state` row count with on-chain `matchCounter`.** The mirror lags when an upsert misses. Chain is the source of truth for total matches.

---

## Related

- Main project README: [../README.md](../README.md)
- Agent that writes `agent_match_state` rows: [../agent/README.md](../agent/README.md)
