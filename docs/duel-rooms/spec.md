# Duel Rooms & Challenges — Full Spec (design locked)

> **Status: SHIPPED (Friend Duels live).** The core — on-chain escrow, create/join,
> allowlist, trustless refunds, resolution, and the hub — is deployed and live.
> This doc is now a spec-vs-reality record; per-item implementation status is
> marked inline with **✅ Shipped**, **◻️ Not shipped**, or a note where the live
> build differs from the original design.
>
> **Live references**
> - Contract: `DuelEscrow` at `0x5dd223edb320Bc7e5D1DbF0D68512D1917E0c557` (Celo mainnet) · source `contracts/src/DuelEscrow.sol`
> - Frontend: `frontend/app/duel/*` (hub `page.tsx`, `create/`, `[id]/`), `frontend/hooks/useDuel.ts`, `frontend/lib/duel.ts`
> - Backend: `games-backend/lib/duelRooms.js` → `/api/duel/*`
>
> **Key deviation from this spec:** the per-room cut shipped as **`feeBps` → treasury**
> (hard ceiling `MAX_FEE_BPS = 20%`), not the `ubiBps` named in §6. Sponsored pools
> set `feeBps = 0` (winner takes the full prize). This matches §4's "fee to treasury"
> decision; §6's `ubiBps` naming is superseded.

The complete design for the rooms / challenges / prize-pool feature. Money
custody is on-chain (`DuelEscrow`); the backend coordinates and gates entry; the
frontend is the flow. First real use: a community's **$50 private prize pool**,
replacing the manual screenshot + verified-list process.

---

## 1. What it is (plain)
A **room** is a game challenge with a prize. People join, everyone plays a run
on the existing engine, **highest score wins the prize.** Anyone can create one
(a player challenging a friend, or an admin running a community pool).

## 2. Room types — from 3 dials
| Dial | Options |
|---|---|
| Visibility | **Public** (listed in the hub) · **Private** (link/code, unlisted) |
| Entry | **Stake** (players pay in) · **Free** (no entry) |
| Prize seed | **None** · **Seeded** (creator/sponsor puts up a prize) |

The useful shapes that fall out:
- **Friend duel** — private, cap 2, stake, no seed.
- **Open room** — public, cap N, stakes pooled.
- **Sponsored pool** — private/public, **free entry**, seeded prize (the $50 pool).
- **Boosted room** — stake + a seeded bonus.

## 3. Entry gating — per-room, creator chooses (this is the "options")
A room can require any combination of:
1. **Open** — anyone can join (public rooms).
2. **Code** — the private join-code carried in the share link. Hand the code
   only to people who did the task (e.g. **voted**), so the code *is* the reward
   for voting. No app-side vote check needed; you control who gets the code.
3. **Allowlist** — the creator/admin adds the exact wallets that may join (import
   the voted + verified list). Strongest gate: even with the code, a wallet not
   on the list cannot join. Enforced **on-chain**.
4. **Verified-required** — GoodDollar `isWhitelisted` toggle for prize rooms.
   For the pool, the admin only adds verified wallets to the allowlist, so this
   comes for free.

**The $50 pool uses: Private + Allowlist (voted+verified wallets) + Free entry + Seeded prize.**
No manual list-keeping: the allowlist *is* the list, on-chain.

## 4. Prizes & payout
- **Pot = seeded prize + all stakes.**
- **Fee is per-room and goes to the TREASURY (platform revenue).**
  - **Community / sponsored pools → 0% fee** (winner takes the FULL prize) and
    the room is **private / unlisted** (nobody else can see or find it).
  - **Stake-vs-stake duels → a fee to the treasury** (the platform's cut on
    real-money bets). Default proposed **10%**, owner-configurable, capped.
  - (This replaces the old "20% to UBI" global. Fee recipient = treasury; a UBI
    portion can be layered later if wanted, but default routing is treasury.)
- **Payout mode (per room):**
  - **Winner-takes-all** (default).
  - **Top-3 split** (optional, e.g. 60/25/15) for bigger rooms so more people win.
- **Winner is derived on-chain** from the validator's submitted scoreboard
  (highest score; ties → earliest entrant). The validator cannot hand-pick.

## 5. The rest of the feature set (the "other features")
- **Free-first challenges** — a challenge can be pure bragging rights (no stake,
  no prize): off-chain score compare + a rivalry record. Drives volume; staked/
  seeded rooms are the money layer on top.
- **Rivalries** — persistent head-to-head record per pair ("You vs Sam 4-3") with
  one-tap Rematch on the game-over screen. The retention engine.
- **Challenges hub** — one home: public rooms to join · your live rooms with
  countdowns · challenges waiting for you · your rivalries.
- **MARKOV as house challenger** — no friend online? MARKOV throws a (voiced)
  daily challenge. Ties into the Voice MARKOV work already shipped.
- **Discovery** — a challenge lands in the target's `notifications_feed` + a web
  push ("Sam challenged you — 18h left"), and prompts at every game-over.

## 6. Contract changes (DuelEscrow v2) — ✅ Shipped (deployed `0x5dd2…0c557`)
Current contract already does rooms + private code + seed + trustless
`refundUnfilled`/`refundAll`. Add:
1. **Per-room cut** — ✅ Shipped **as `feeBps` → treasury**, not `ubiBps`.
   `createRoom` takes `feeBps` (0..`MAX_FEE_BPS = 2000` = 20%); sponsored pools set
   `feeBps = 0` so the winner takes the full prize. Fee routes to the per-room
   `treasury` (owner-settable), per §4.
2. **Per-room allowlist** — ✅ Shipped. `useAllowlist` flag on the room; `joinRoom`
   reverts with `NotAllowlisted` when set and caller isn't listed.
   `addToAllowlist`/`removeFromAllowlist` managed by owner or room creator. Off by
   default (public/code rooms don't use it).
3. **`forceRefund`** — ✅ Shipped. Trustless backstop: anyone can call after
   `deadline + forceRefundGrace` (owner-configurable via `setForceRefundGrace`) on a
   contested room that was never resolved, returning stakes to players and the seed
   to the sponsor.
4. **Top-3 split** payout mode — ◻️ Not shipped. `resolveRoom` pays
   **winner-takes-all** (highest score; ties → earliest entrant). Left as a future
   option.

**Also shipped:** gasless `createRoomWithPermit` / `joinRoomWithPermit` (EIP-2612),
`MAX_CAPACITY = 256`, Ownable2Step + Pausable + ReentrancyGuard + SafeERC20 + custom
errors, 100% branch/function coverage (see `nfr.md`).

## 7. Architecture
- **Contract (`DuelEscrow` v2)** — source of truth for funds, membership,
  allowlist, resolution. Immutable; tuned via owner setters.
- **Backend (`duel` module, existing Node backend)** — one vertical slice.
  ✅ Shipped as `games-backend/lib/duelRooms.js`. Live endpoints:
  - `GET /api/duel/rooms` (public hub feed) · `GET /api/duel/my?wallet=` (a
    player's rooms) · `GET /api/duel/room/:id` (detail + participants) ·
    `POST /api/duel/sync/:id` (trustless mirror of one room from chain) ·
    `POST /api/duel/resolve/:id` (internal, `x-internal-secret`; validator
    submits the scoreboard) · `GET /api/duel/rivalry?a=&b=` (head-to-head).
  - **Deviation:** there is **no** `POST /create`, `/join`, or `/allowlist`
    backend endpoint. Create / join / allowlist run **client-side on-chain** from
    `frontend/hooks/useDuel.ts` (`createRoomWithPermit`, `joinRoomWithPermit`,
    `addToAllowlist`) — gasless via the player's own permit signature, no backend
    relay. The backend only mirrors chain state and resolves.
  - Supabase mirror of rooms/participants for fast queries + private filtering,
    reconciled against on-chain events.
  - Reuses: `isVerified`, the anti-cheat scoring, the permit relayer, the
    `notifications_feed` + push, `mapLimit`/cache helpers.
- **Frontend (`duel` feature)** — create-room flow (pick type/gating/prize/
  window/payout), room page (join → play in duel mode → result), Challenges hub,
  admin panel for pools (create + paste/manage the allowlist), game-over entry
  points (Challenge / Open room / Rematch). Reuses podium, rows, verify gate,
  telegram deep-link, share card.
- **Money is gasless** for players (EIP-2612 permit + existing relayer); only the
  validator's `resolveRoom` tx costs gas.

## 8. Data model (Supabase, mirror only — chain is truth)
- `duel_rooms`: id (on-chain roomId), creator, game_type, visibility, gating,
  stake_wei, seed_wei, ubi_bps, capacity, deadline, status, tx hashes, created_at.
- `duel_participants`: room_id, wallet, joined_at, score (filled on resolve).
- `duel_allowlist`: room_id, wallet (the voted+verified list).
- `rivalries`: wallet_a, wallet_b, wins_a, wins_b, ties, last_played.

## 9. Build phases (definition of done)
- **P1 — Contract v2**: ✅ per-room cut (`feeBps`) + allowlist + forceRefund, tests
  to 100%. Top-3 split ◻️ not shipped (winner-takes-all).
- **P2 — Backend `duel` module**: ✅ resolve/list/mirror + tables. (Create/join/
  allowlist run client-side on-chain, not as backend endpoints — see §7.)
- **P3 — Frontend pool flow**: ✅ create room, room page, join, play, result,
  admin allowlist. **← everything the $50 pilot needs.**
- **P4 — Challenges hub + game-over entry points + notifications**: ✅ hub live
  (`/api/duel/rooms` + `frontend/app/duel`).
- **P5 — Rivalries + MARKOV house challenger**: rivalries ✅ (`GET /api/duel/rivalry`,
  `rivalries` table). Voice MARKOV already shipped.
- **P6 — Deploy to Celo mainnet + run the $50 pilot pool**: ✅ deployed to Celo
  mainnet (`0x5dd2…0c557`).

---

## Open items to confirm before P1 — resolved as built
1. `forceRefund` grace window: shipped as owner-configurable `forceRefundGrace`
   (`setForceRefundGrace`), not a fixed constant.
2. Payout: shipped **winner-takes-all**; top-3 split left unbuilt.
3. Verified-required: shipped the simplest path — the admin allowlists wallets
   (which can be the voted+verified list); no on-chain identity check inside
   `joinRoom`.
