# Duel Rooms & Challenges — Full Spec (design locked)

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
- **UBI cut is per-room.** Community/sponsored pools = **0% (winner takes the
  full prize)**. Stake-vs-stake duels can keep a cut if we ever want one, set per
  room. (Change from the old global 20%.)
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

## 6. Contract changes (DuelEscrow v2)
Current contract already does rooms + private code + seed + trustless
`refundUnfilled`/`refundAll`. Add:
1. **Per-room `ubiBps`** — `createRoom` takes a cut (0..`MAX_UBI_BPS`); pools set 0.
2. **Per-room allowlist** — optional; if set, `joinRoom` requires the caller be
   allowlisted. Admin manages it (`addToAllowlist`/`removeFromAllowlist`, owner
   or room creator). Off by default (public/code rooms don't use it).
3. **`forceRefund`** — trustless backstop: anyone can call after
   `deadline + graceWindow` (proposed 2 days, owner-configurable) if a contested
   room was never resolved, returning stakes to players and the seed to the
   sponsor. Closes the "validator vanished" reliability gap.
4. (Optional) **Top-3 split** payout mode.
Re-test to 100% branch/function coverage; keep Ownable2Step + Pausable +
ReentrancyGuard + custom errors.

## 7. Architecture
- **Contract (`DuelEscrow` v2)** — source of truth for funds, membership,
  allowlist, resolution. Immutable; tuned via owner setters.
- **Backend (`duel` module, existing Node backend)** — one vertical slice:
  - Endpoints: `POST /api/duel/create`, `POST /api/duel/join` (gasless relay),
    `GET /api/duel/rooms` (public hub feed), `GET /api/duel/room/:id`,
    `POST /api/duel/resolve` (validator submits scoreboard),
    `POST /api/duel/allowlist` (admin adds wallets), plus rivalry reads.
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
- **P1 — Contract v2**: per-room ubiBps + allowlist + forceRefund (+ optional
  top-3), tests to 100%, deploy to a local anvil Celo fork.
- **P2 — Backend `duel` module**: create/join/resolve/list/allowlist + tables.
- **P3 — Frontend pool flow**: create sponsored private pool, room page, join,
  play, result, admin allowlist paste. **← this is everything the $50 pilot needs.**
- **P4 — Challenges hub + game-over entry points + notifications.**
- **P5 — Rivalries + MARKOV house challenger.**
- **P6 — Deploy to Celo mainnet + run the $50 pilot pool.**

**Pilot-critical path = P1 + P2 + P3.** P4–P5 are the retention layer that
follows. Voice MARKOV is already shipped.

---

## Open items to confirm before P1
1. `forceRefund` grace window: **2 days** after deadline (proposed).
2. Payout: ship **winner-takes-all** first, add top-3 split as a P4 option? (yes/no)
3. Verified-required: rely on the admin only allowlisting verified wallets
   (recommended, simplest) vs. an on-chain identity check in `joinRoom`?
