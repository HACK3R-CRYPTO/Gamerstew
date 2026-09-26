# Flow State update — paste-ready (2026-09-26)

Copy each block into its Flow State box. Every number is live from production or
the on-chain payout ledger. [CONFIRM] = only you can settle it before submitting.

LIVE NOW
  803 wallets · 129 verified humans (16%) · 60,457 on-chain games
  21,385 G$ routed to the GoodDollar UBI pool
  Paid to players: 2,106,455 G$ + $50 USDC across 4 competitions, 43 slots

Build M1, M2, M3 are already at 100%. Leave them. The blocks below are the ones
still showing 0% or needing a refresh.

════════════════════════════════════════════════════════
BUILD MILESTONE 4 · Public Dune Dashboard + Competition Automation
════════════════════════════════════════════════════════

── Deliverable 1 (Public Dune covering all season KPIs) → 45% ──
Dashboard live at dune.com/ogazboiz/gamearena: wallets, active players,
transactions, player segments, habitat UBI flow, top players. Competition
payouts are now tracked and public on the impact page (gamearenahq.xyz/impact),
each with its Celoscan tx, and served from a committed ledger at /api/payouts.
Remaining for 100%: port the payouts-by-competition, paying-wallets and
UBI-by-rail panels onto Dune itself.

── Deliverable 2 (Competition automation: scheduled sealing + payout batching) → 35% ──
Standings and notifications run automatically: the live event computes standings
from chain with single-flight caching and no manual step, and a cron fires its
eve / launch / low-slots / last-day pushes on its own. Payouts run through
idempotent, dry-run-first batch scripts that never double-pay. Remaining:
scheduled sealing and hands-off payout batching.

── Other Details & Updates ──
Competition payouts are now a public, auditable record on the impact page rather
than living only in announcements. Four competitions have paid verified players:
Community Pool 366,135 G$ (28 players, on-chain), Loyalty Pool 320,000 G$ (5),
Skill Sprint $50 USDC (10), Arena Cup ~1,420,320 G$ ($150 at the live G$ rate).
Two carry their Celoscan tx; the older two are being linked.

════════════════════════════════════════════════════════
GROWTH MILESTONE 3 · Month 3 (200 wallets, 75 verified, 30 duels, 4000 tx, 5 collectives) → 85%
════════════════════════════════════════════════════════

── Activation 1 → 85% ──
── Other Details & Updates ──
803 total GamePass wallets against the 200 target. 129 GoodDollar-verified humans
against the 75 target (live isWhitelisted read). 60,457 on-chain transactions
against the 4,000 monthly target. Perk-paying wallets past the 60 target.
Friend duels shipped and live (Build M3), settling on-chain with the 20% UBI cut;
distinct verified-pair count is [CONFIRM]. The one open item is the 5-collective
spread: player-directed G$ currently routes to the on-chain-verified GoodDollar
UBI pool, with more collectives added as their pool addresses are verified with
the GoodDollar team.

════════════════════════════════════════════════════════
GROWTH MILESTONE 4 · Season totals (400K G$ paid, 8000 tx, 2500 G$ UBI, zero missed) → 85%
════════════════════════════════════════════════════════

── Activation 1 → 85% ──
── Other Details & Updates ──
G$ paid to verified-human players through competitions has passed the 400,000
season target by more than 5x: 2,106,455 G$ plus $50 USDC across four
competitions, 43 paid slots, every settled payout on-chain. 60,457 season
transactions against the 8,000 target. 21,385 G$ routed to the GoodDollar UBI
pool against the 2,500 target, over 8x. Zero missed competition cycles [CONFIRM].
The full payout record with tx links is public at gamearenahq.xyz/impact.
Remaining 15%: the same figures on the Dune dashboard (this milestone commits to
"verifiable on the public Dune dashboard"), which needs the payouts query added.

════════════════════════════════════════════════════════
GROWTH MILESTONE 2 · Month 2 → bump 80% to 100%
════════════════════════════════════════════════════════
── Other Details & Updates (append) ──
All Month 2 targets now met or exceeded: 803 wallets (target 160), 60,457
transactions (target 2,500), 21,385 G$ to UBI (target 1,000). Referral tracking
live through the Passport; referral sign-ups counted at verification now past the
15 target [CONFIRM exact count].

════════════════════════════════════════════════════════
BEFORE YOU SUBMIT
════════════════════════════════════════════════════════
1. The 2,106,455 G$ includes the Arena Cup valued at the LIVE G$ rate
   (0.00010561 USD/G$). That figure moves with the rate. The exact on-chain G$
   amount from the Cup payout tx would be the fixed, unarguable number — worth
   swapping in once the tx is linked.
2. Settle each [CONFIRM]: duel pair count, zero-missed-cycles, M2 referral count.
3. The one honest gap across M4 build + M4 growth is the same thing: payouts are
   on the impact page but not yet on Dune. One Dune query closes both.
