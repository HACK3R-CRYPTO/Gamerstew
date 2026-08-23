# Duel Rooms — Non-Functional Requirements

Feature: peer-to-peer and sponsored G$ "duel rooms" (friend duel, open room,
sponsored private prize pool). First real use: a community's **$50 private
prize pool**, replacing the manual screenshot / verified-list process.

**The single fact that shapes every NFR:** money custody is **on-chain** in
`DuelEscrow`, not in our backend. The backend only *coordinates* (mirrors rooms,
gates entry, submits the validated scoreboard). It never holds stakes or prizes.
This de-risks availability, cost, and most of security by design.

Scale assumption (right-sized, not aspirational): **hundreds** of players,
**tens** of concurrent rooms, community pools of **$50–$500**. Not millions.
Targets below are deliberately modest; inflating them is how you over-engineer.

---

## 1. Availability
- **API (create/join/list/resolve orchestration): 99% monthly** (~7h/mo budget).
  Not 99.95% — this is an early-stage community feature, and downtime never
  risks funds because the escrow + trustless refunds live on-chain.
- **Money layer: = Celo's availability.** Not ours to guarantee. Stakes are
  safe and recoverable even if our whole backend is down.
- *Challenge applied:* dropped the instinct to promise five-nines. The on-chain
  safety valves make short downtime a UX inconvenience, not a money incident.

## 2. Performance
- **Reads** (room list / hub, room detail): p95 < 800 ms, p99 < 1.5 s
  (Supabase query + cached on-chain reads).
- **Writes** (create/join): API responds < 500 ms to hand back the tx to sign;
  on-chain confirmation is bounded by Celo block time (~5 s) and surfaced as a
  "confirming…" state, never hidden behind a spinner that looks hung.
- *Challenge applied:* no sub-100 ms target. These are low-frequency, money-
  weight actions; users accept "confirming on Celo." Don't fight block time.

## 3. Scalability
- Design for **~500 concurrent players, ~50 concurrent open rooms**; a pool
  launch = tens joining within minutes (handled by a single Postgres + one
  backend instance, no queue).
- Data growth: rooms + participants + resolutions ≈ low thousands of rows/mo —
  trivial for Supabase; no partitioning, no sharding.
- Contract bounds: `MAX_CAPACITY = 256` caps per-room gas (refund/scan loops).
- *Challenge applied:* no microservices, no message bus. One module in the
  existing monolith backend. Extract later only if a room ever needs 1000s.

## 4. Security (the one that matters — it's money)
- **No backend custody.** Stakes and seeded prizes are escrowed on-chain; the
  backend can never move them. This is the headline security control.
- **Winner is derived on-chain** from the validator's submitted scoreboard
  (`resolveRoom` picks the max; ties → earliest entrant). The validator cannot
  name an arbitrary winner — only participants can be paid.
- **Entry gating for prize rooms:** GoodDollar-verified (`isWhitelisted`) **and**
  the private join-code (in the share link). Verified-only = the manual
  "verified list" becomes automatic; join-code = only the invited community.
- **Anti-cheat:** reuse the existing server-authoritative scoring (input-log
  replay). No new scoring surface.
- **Auth:** existing wallet auth (Privy) for players; `x-internal-secret` for
  server-to-server; validator key = existing anti-cheat authority.
- **Blast radius of a compromised validator key:** it could submit false
  scores, but funds still only reach real participants, and `Pausable` +
  `setValidator` (Ownable2Step) allow immediate containment + rotation.
- *Challenge applied:* no formal audit gate for a $50 pilot. The contract ships
  with 100% branch/function test coverage and standard hardening (Ownable2Step,
  Pausable, ReentrancyGuard, SafeERC20, custom errors). Revisit audit before
  pools reach four figures.

## 5. Cost
- **Infra: ~$0 marginal.** Reuse Railway (backend) + Vercel (frontend) +
  Supabase + the existing subgraph. No new services.
- **Gas: fractions of a cent** per action on Celo. Players pay **zero CELO** —
  create/join go through EIP-2612 `permit` + the existing relayer (the same
  gasless path skill-game scores use). Only the validator's `resolveRoom` tx
  costs gas, from the existing validator wallet.
- **Prize pools are sponsor-funded**, not platform-funded. The 20% UBI cut is a
  routing, not a platform expense.

## 6. Reliability
- **Every room reaches a terminal state (Resolved or Refunded).**
  - Nobody joined → `refundUnfilled` (trustless, anyone can call). ✅
  - Contested but no valid scores → `refundAll` (validator). ✅
  - **GAP TO CLOSE:** a *contested* room whose validator never resolves has no
    trustless exit — funds could sit until the owner intervenes. **Requirement:**
    add a trustless `forceRefund` callable by anyone once `deadline + grace`
    (e.g. 7 days) passes, returning stakes to players and the seed to the
    sponsor. This guarantees no configuration of downtime can trap funds.
- Idempotency: create/join/resolve mirrors keyed on `roomId` + tx hash so a
  retry can't double-record.

## 7. Maintainability
- One vertical-slice `duel` module in the existing backend (routes + Supabase
  access + contract wiring in one place), mirroring how the arena/cup code is
  organized. Contract is immutable; behavior tuned via owner setters.
- Frontend: a `duel` feature folder + the game-over entry points; reuse existing
  components (podium, rows, share/telegram deep-link, verify gate).

## 8. Testability
- Contract: **100% branch/function coverage already** (57 tests).
- Backend: score→winner selection and entry-gating are pure/deterministic and
  unit-testable; the on-chain path is tested end-to-end against a **local anvil
  Celo fork** (real G$ addresses, zero mainnet risk) before mainnet deploy.

---

## Open decisions for Step 3 (architecture)
1. **Resolution trust:** keep validator-submits-scoreboard (simple, matches
   existing anti-cheat) vs. a more trustless commit-reveal. *Lean: keep it; add
   the `forceRefund` backstop instead of full trustlessness for a pilot.*
2. **Backend vs. contract as source of truth for the room list/hub:** index
   on-chain events vs. a Supabase mirror written on create/join. *Lean: Supabase
   mirror for speed + private-room filtering, reconciled against chain.*
3. **`forceRefund` grace period:** 7 days after deadline (proposed).
