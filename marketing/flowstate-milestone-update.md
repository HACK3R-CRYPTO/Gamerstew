# Flow State milestone update — paste-ready

Copy each block into the matching Flow State edit box. Numbers are what I could
verify from the repo and chain. Anything marked [CONFIRM] is a figure only you
can settle before submitting, because Rael can check it on-chain.

Verified from the codebase:
- Community weekly pool: 105,000 G$ to 15 verified players (payout-community-pool.js)
- Private sprint: 430,000 G$ pool, top-10 graduated, 16-player roster (run-sprint.sh)
- Live now: 788 wallets · 127 verified · 59,360 games · 21,385 G$ to UBI
- impact page tracks ONLY perk spend — competition payouts are NOT on it
- Dune has players/games/segments/habitats/UBI — NO payouts-by-competition panel

────────────────────────────────────────────────────────

## Growth Milestone 3 (Month 3) → set to ~90%

**Other Details & Updates:**

788 total GamePass wallets against the 200 target. 127 verified humans right
now (live isWhitelisted read) against the 75 target. 59,360 on-chain score
transactions against the 4,000 monthly target. Perk-paying wallets well past the
60 target (44 recorded by Month 1, more since).

Two competitions settled to verified players since Month 2: the weekly community
pool (105,000 G$ to 15 verified players, games-weighted, unverified earn nothing)
and a private 5-day skill sprint (430,000 G$ pool, top-10 graduated split, a
curated 16-player verified roster). A third is live now: Verified Tug of War, a
7-day team event with GoodDollar verification as the entry condition.

Gap to 100%: player-directed G$ currently routes to the on-chain-verified
GoodDollar UBI pool; the 5-collective spread waits on more pool addresses being
verified with the GoodDollar team. Duels shipped (Build 3) but distinct-pair
settlement count is [CONFIRM].

────────────────────────────────────────────────────────

## Growth Milestone 4 (Season totals) → set to ~70%

**Other Details & Updates:**

G$ paid to verified-human players through competitions is already past the
400,000 season target: 105,000 G$ community pool + 430,000 G$ private sprint =
535,000 G$, before the Tug of War pool now in flight. [CONFIRM the exact total
if a second weekly round was paid.]

8,000 season transaction target already exceeded: 59,360 on-chain score events.
2,500 G$ to UBI target exceeded: 21,385 G$ routed to the GoodDollar UBI pool.

The remaining 30% is honest: these payouts are real on-chain but are NOT yet on
the public Dune dashboard. The season commits to every payout being "verifiable
on the public Dune dashboard", and the payouts-by-competition panel is not built
yet. Same blocker as Build Milestone 4 below.

────────────────────────────────────────────────────────

## Build Milestone 4 · Dune Dashboard + Automation

**Deliverable 1 (Public Dune covering all season KPIs) → set to ~40%**

Dashboard is live at dune.com/ogazboiz/gamearena covering wallets, active
players, on-chain transactions, player segments, habitat UBI flow and top
players. Missing the season-specific panels: G$ payouts by competition, paying
wallets, and G$ to UBI by rail. Those are the ones this milestone names, so it
is partial, not done. Building them next.

**Deliverable 2 (Competition automation: scheduled sealing + payout batching) → set to ~35%**

Standings and notifications are automated: the Tug of War computes standings
from chain with single-flight caching and no manual operation, and a cron fires
the event's eve / launch / low-slots / last-day pushes on its own. Payout
batching is still run by hand through idempotent, dry-run-first scripts
(payout-community-pool.js, run-sprint.sh) that never double-pay. Scheduled
sealing + automatic batching is the remaining work.

────────────────────────────────────────────────────────

## The tracking gap, stated plainly (this is your Dune answer to Rael)

You are right that the community pool and the sprint are not on the impact page
or the Dune dashboard. The impact endpoint tracks perk spend only. The Dune
dashboard has no payouts panel at all. So when Rael compares his data to ours,
the payouts simply are not represented on our side yet.

That single missing panel — G$ paid per competition, to verified wallets, over
time — is what closes Build M4 D1, most of Growth M4, and answers his question
in one build. It is the highest-leverage thing left this season.
