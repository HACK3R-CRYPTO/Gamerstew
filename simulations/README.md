# GameArena Monte Carlo Simulations

Simulation suite validating the fairness and skill-basis of GameArena's game
logic and the farm-resistance of the weekly ladder economy.

**Run it yourself:** `node simulations/run.js` — zero dependencies, seeded PRNG,
fully deterministic: you will reproduce these exact numbers. Results also in
`results.json`.

Every formula is an exact port of production code (file references in each
`*.sim.js`): the scoring math in `games-backend/lib/rhythmScoring.js`, the
frontend game loops, MARKOV's decision engine in `games-backend/lib/arenaMatch.js`,
and the ladder points in `games-backend/server.js`.

---

## 1 · MARKOV is fair — and beats patterns, not people

20,000 best-of-5 matches per player archetype against MARKOV's real decision
engine (markov-2/1/histogram opponent model, 70/30 model/random mix,
commit-reveal seeded):

| archetype | player match win % | MARKOV win % | notes |
|---|---|---|---|
| uniform random | **48.1** | 47.7 | statistically even — no house edge |
| rock-leaning human | 43.8 | 52.8 | mild bias, mildly punished |
| win-stay/lose-shift | 41.0 | 58.6 | common human heuristic, exploited |
| copycat | 42.0 | 55.6 | pattern exploited |
| counter-chaser | 41.5 | 56.0 | naive adaptation exploited |
| cycler (R→P→S) | 15.1 | 84.9 | hard pattern, shredded |

**Findings:**
- Against a perfectly unpredictable player, MARKOV wins 47.7% vs the player's
  48.1% (remainder ties): **no built-in house edge**. The engine's advantage
  comes entirely from opponent predictability — which is the skill claim:
  the way to beat MARKOV is to be less predictable, and the game rewards
  exactly that.
- "CALLED IT" rates scale with predictability (1.42/match vs random → 2.82 vs
  the cycler), confirming the read meter measures something real.
- Win rates are stable between a player's first 500 and last 500 matches —
  the model doesn't degrade or rig outcomes over time.

## 2 · The skill games measure skill

10,000 runs per ability tier, pushing modeled players (timing error σ, recall
probability p, aim error σ) through the exact production scoring formulas:

**Rhythm Rush** (tap error σ): expert (35ms) median **2042** · skilled (70ms)
1804 · casual (120ms) 1411 · novice (200ms) 423 · masher (350ms) 204.
A casual player's 90th percentile (1626) is below a skilled player's 10th
(1699) — **tiers separate cleanly; a lucky bad run cannot beat a good player**.

**Simon Memory** (recall p): expert reaches median depth 11 (median 132 pts)
vs novice depth 2 (73 pts). Score is monotonic in recall ability.

**Stack Tower** (aim σ, degrading with block speed): expert median 64 vs
novice 6 — a 10× separation.

## 3 · The weekly pool pays winners, not grinders

500 simulated weeks per scenario, 500 G$ pool, top-heavy payout scheme
(30/20/12% podium, 28% shared across 4th–10th, 10% across 11th–20th).
Population mixes skilled "sharks", regulars, casuals, and **grinders who
loss-spam the maximum 10 matches every day**:

| scenario | shark avg G$/wk | grinder avg G$/wk | grinder podium rate |
|---|---|---|---|
| 10 players | 125.0 | 49.1 | 24% |
| 25 players | 82.5 | 19.1 | 0% |
| 50 players | 51.3 | 9.6 | 0% |
| 200 players | 16.7 | 0.0 | 0% |

**Findings:**
- **Farm-proof**: max-volume losing play (grinder: ~243 pts/week) cannot catch
  skilled play (shark: ~382 pts/week). The points formula (win 10 / loss 2)
  plus the daily match cap bounds grinder throughput below winner throughput.
- The daily limit also hard-caps any single wallet's point production, so the
  pool can't be drained by one actor at any population size.
- As the arena grows, rewards concentrate on genuine top performers — the
  pool's cost per week stays fixed (it's a budget, not a formula), so the
  economics are safe at every scale.

## Caveats (honest limits of the model)

- Player archetypes are behavioral models, not recordings of real players;
  real human predictability likely sits between `uniform_random` and
  `win_stay_lose_shift` (i.e. real win rates vs MARKOV around 41–48%).
- Skill-game player models (gaussian timing/aim error, per-element recall)
  are standard simplifications; they model relative tier separation, not
  absolute leaderboard values.
- The payout scheme simulated here is the proposed one; the live pool split
  is configuration and can be tuned with these simulations before changing it.
