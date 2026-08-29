#!/usr/bin/env bash
# GameArena private 5-day sprint — payout, all decisions baked in.
#
#   Dry run (safe, shows the board + split):
#       ./scripts/run-sprint.sh
#
#   Pay for real (after the sprint ends):
#       export POOL_PRIVATE_KEY=0x...        # wallet holding the 430,000 G$
#       ./scripts/run-sprint.sh --send
#
# Decisions locked in:
#   • Games:   Rhythm Rush, Simon Memory, Stack   (Challenge AI excluded)
#   • Roster:  the 15 hand-picked players (scripts/sprint-players.txt)
#   • Verify:  trust the roster (GoodDollar whitelist may have lapsed)
#   • Winners: top 10, graduated split (climb higher = win more)
#   • Pool:    430,000 G$  (~$50 at ~$0.000117/G$)
#   • Window:  Mon 1 Sep 00:00 UTC → Sat 6 Sep 00:00 UTC (5 days)
set -euo pipefail
cd "$(dirname "$0")/.."

GAMES=0,1,2 \
VERIFY=roster \
SPLIT=graduated \
WINNERS=10 \
MIN_SCORE=1 \
POOL_TOTAL_G=430000 \
SAT_START=2026-09-01T00:00:00Z \
SAT_END=2026-09-06T00:00:00Z \
ELIGIBLE_FILE=scripts/sprint-players.txt \
node scripts/payout-saturday-pool.js "$@"
