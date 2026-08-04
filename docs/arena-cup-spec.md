# Arena Cup — Build Spec

The first real-money, skill-based, verification-gated event. Two ladders (humans + their AIs) on one board, one community-grown pot. This is the source of truth for the build.

---

## 0. Locked decisions (defaults — change any single line)

| Knob | Value |
|---|---|
| Duration | **14 days** · Fri Aug 7 → Fri Aug 21, 17:00 WAT (16:00 UTC) |
| Scope | **All 4 games** — Simon, Rhythm, Stack, Challenge AI |
| Prize | **$150 in G$** → Human Cup **$100** + Agent Cup **$50** |
| Pot | **Community-grows-it** — $150 base + bonus G$ as total plays hit milestones |
| Eligibility (to WIN) | **GoodDollar-verified humans only** (`isWhitelisted`) |
| Eligibility (to PLAY) | anyone; guests get the demo, unverified can play but not win |

**Prize split**
- Human Cup ($100): Champion **$40** · 2nd **$25** · 3rd **$15** · Top Connector **$12** · Iron Streak **$8**
- Agent Cup ($50): Top Agent **$30** · 2nd **$12** · 3rd **$8**
- Everyone who qualifies (≥5 verified games + a new personal best): **Passport winner badge** + share of the community G$ side-pool

---

## 1. Data model — everything reuses what already exists

| Lane / need | Source (already in the codebase) |
|---|---|
| Skill (best run/game) | Supabase `scores` (per-game, per-player) |
| Consistency (distinct days) | Supabase `activity` / `game_sessions` (timestamps) |
| Referrals | `lib/referral.ts` + `/api/season/join` (stores `referrerWallet`) |
| G$ spend | Supabase `arena_purchases` (player, totalPaid, ubiAmount) |
| Agent Cup | GoodAgents partner endpoint `goodagentids.xyz/host/partners/gamearena/agents` + Supabase `agent_match_state` |
| Verification gate | backend `isVerified(wallet)` → GoodDollar `isWhitelisted` |
| Winner badge | `WinnerBadge.sol` (already deployed) |
| Community pot / total plays | subgraph `globalStat.totalScores` + event-window count |

**No new tables required for v1.** A small `cup_config` constant block in the backend + read-time computation (same pattern as `/api/weekly-challenge`).

---

## 2. Cup Points — the math

Per player, over the event window `[start, end)`, verified only:

```
CupPoints =  W_skill   * SkillScore
           + W_consist * ConsistencyScore
           + W_ref     * ReferralScore
           + W_spend   * SpendScore
```

**Lane formulas (with caps that make it unfarmable):**

- **SkillScore** = Σ over 4 games of `bestRunPoints(game)`.
  `bestRunPoints` = the player's single best server-verified run that window, mapped to points via the game's existing score divisor (peak, NOT sum → grinding earns nothing).

- **ConsistencyScore** = `min(14, distinctUtcDaysPlayed)`.
  One credit per calendar day. A second game same day = 0 extra.

- **ReferralScore** = count of referred wallets that **verified AND played ≥3 games** in the window.
  Fake/idle referrals = 0. Sybil-proof (each needs a real GoodDollar face).

- **SpendScore** = `round(K_spend * sqrt(totalG$Spent))`.
  **Uncapped, sub-linear.** Spending always earns more (GoodDollar loves usage), but 100× spend ≈ 10× points, so no one buys the crown. `K_spend` tuned so a heavy spender ≈ strong in one other lane, never all.

**Starting weights** (tune after a dry run): `W_skill=1.0, W_consist=8, W_ref=25, W_spend=1.0`.
Rationale: skill dominates, one referral (25) ≈ a great single run, showing up daily compounds, spend is a real-but-minor boost.

**Special crowns** (separate ladders so one strength can't sweep the main board):
- Top Connector = max ReferralScore
- Iron Streak = max ConsistencyScore (tie-break: CupPoints)

**Tie-breaks everywhere:** earliest to reach the score (rewards showing up, not last-night sniping).

---

## 3. Agent Cup — ranking

Deployed agents (from the partner endpoint) ranked by performance vs MARKOV in the window:
```
AgentScore = wins - losses  (from agent_match_state, window-filtered)
             tie-break: win-rate, then earliest
```
Agents are **daily-capped** (`dailyMatchCap`) and on-chain-registered to an operator → can't be farmed. Owner names shown. Agent matches ALSO feed the Community Pot (drives plays → GoodAgents' $50 earns out).

---

## 4. Backend (games-backend)

- `cup_config`: `{ startsAt, endsAt, humanSplit, agentSplit, weights, K_spend, potMilestones }`
- **`GET /api/cup`** → `{ window, human: [{wallet, username, cupPoints, lanes, rank}], agent: [...], pot: {plays, target, bonusG, tiersHit}, me: {rank, cupPoints, lanes, toNext} }`
  - Computed on read, cached ~60s (same as `/api/weekly-challenge`). Verified-only filter applied.
- **`GET /api/cup/agents`** → agent ladder (partner endpoint ∩ `agent_match_state` window).
- Reuse `isVerified`, `resolveUsername`, `cacheGet/Set`.

## 5. Frontend

- **Events page card** (`/leaderboard`): a live "Arena Cup" `LiveEventCard` leading the LIVE tab, tap → the Cup page.
- **`/leaderboard/cup`** (new): two ladders side by side (🎮 Human / 🤖 Agent) + Community Pot progress bar + "you're #N, X to the money" + countdown. Reuse the podium/confetti system from the Challenge AI leaderboard.
- Dashboard hero: swap the "$150 Event · coming soon" slide → "Arena Cup · LIVE" once it starts (the EVENT_HERO we already wired).

## 6. Community Pot

- `plays = totalScores(now) - totalScores(startSnapshot)` (+ agent matches).
- `potMilestones = [{at: 5000, bonusG: 25000}, {at: 10000, bonusG: 50000}, ...]`.
- UI: a climbing bar, "3,400 / 5,000 → +25,000 G$ for everyone."

## 7. Settlement (day 14)

1. Freeze the ladders (final `/api/cup` snapshot).
2. Pay G$ to winners (scripted transfer, verified addresses only).
3. Mint **WinnerBadge** to every qualifier + the crowns.
4. Announce publicly; post the UBI figure from event spend.

---

## 8. Build order (phases)

| Phase | Deliverable |
|---|---|
| **1** | `cup_config` + `GET /api/cup` human ladder (skill + consistency + referral + spend), verified-only, cached |
| **2** | Agent ladder (`/api/cup/agents`) |
| **3** | Community pot counter + milestones |
| **4** | `/leaderboard/cup` page (two ladders + pot + my rank) + events-page card |
| **5** | Settlement script + WinnerBadge mint + announcement (copy + image) |

Each phase ships independently. Phase 1 makes the ladder real; phases stack.

---

## 9. Anti-farm summary (the guarantee)

- Verified humans only → no sybil
- Best-run scoring → no grind
- Distinct-day consistency → no replay farm
- Referrals require verify + play → no fake invites
- √ spend curve, no cap → usage rewarded, not buyable
- Server-authoritative scores + daily agent caps → no cheating/bot farming

## 10. The pitch

> "The Arena Cup: two weeks, two ladders — you and your AI — one growing pot. You climb by being good, showing up, and bringing friends, never by grinding. $100 for players, $50 for agents from GoodAgents. Verified humans only. On Celo, powered by GoodDollar."
