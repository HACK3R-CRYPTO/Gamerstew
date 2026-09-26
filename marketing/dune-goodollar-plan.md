# What GoodDollar should be able to see, and where it stands

## The gap you spotted (correct)

The impact endpoint tracks perk spend only. It does NOT track competition
payouts. So none of this shows anywhere GoodDollar can check:

| Competition | Paid to players | Verified on-chain |
|---|---|---|
| Community Pool (Aug 24 - Sep 6, two weeks) | 366,135 G$ to 28 players | tx 0x1b1228…1366a |
| Skill Sprint (top 10) | $50 USDC to 10 winners | tx 0xdc43be…c3d84 |
| Verified Tug of War (running now) | up to 4,400,000 G$ committed | not paid yet |

Both settled amounts reconcile exactly with your announcements. Each of those
two transactions also carried a matching leg to the treasury wallet
(0xD152f549…), which is change, not a payout, and the Dune query excludes it.

## The fix: one Dune query, three milestones closed

`dune-competition-payouts.sql` sums every G$ and USDC payout from the
competition wallet to players, by competition, with the tx hash on each row so
anyone can verify it. Paste it as a new query on dune.com and add it to the
GameArena dashboard.

That single panel:
- gives GoodDollar a live view of what has moved to real players
- closes Build Milestone 4 Deliverable 1 (Dune covering payouts)
- closes most of Growth Milestone 4 (400K G$ paid, verifiable on Dune)
- answers Rael's "the data seems to differ" directly

I could not create or run it from here (the Dune API key on this machine is
read-only). You paste it; I wrote and address-checked it.

## Two things to know before you publish the panel

1. G$ may have no price feed on Dune, so `usd_value` can be null for G$ rows.
   The G$ `amount` is always correct. USDC rows carry USD directly. Do not
   headline a combined USD figure that silently drops the G$ side.

2. This tracks payouts OUT to players. The G$ routed INTO the GoodDollar UBI
   pool (21,385 G$, from perks + habitats) is a separate flow and already
   partly on the dashboard. GoodDollar cares about both: "we paid players X and
   we contributed Y to UBI." Worth showing them side by side.

## Optional follow-up: put it in the product too

If you want the numbers on the impact page as well as Dune, the backend needs a
committed payout ledger (right now payouts are ad-hoc scripts with no record in
the app). The clean version: log every payout tx hash + competition to a table
when the script runs, then an /api/payouts endpoint reads it. Say the word and
I will wire it.
