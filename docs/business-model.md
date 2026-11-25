# GameArena business model: the Daily Pot

> Status: PROPOSED on 2026-11-26. Nothing in this document is built yet except where a line says "exists". No money code is to be written until the owner approves section 9.

## 1. The idea in one paragraph

Players get a few free ranked plays a day. More plays cost a little G$. Most of what players spend that day becomes that day's prize pot, the best players win it, and GameArena keeps a share of every G$ spent. Nobody outside has to show up: no sponsor, no brand, no grant. The money comes from players, goes mostly back to players, and the house earns on the flow.

## 2. Where each part comes from

| Part | Taken from | Why it is here |
|---|---|---|
| Plays are the product; the day's spend is the day's prize | A peer G$ game on Celo | It funds itself, and buying a play feels like buying a ticket, not paying a fee |
| A price to continue at the moment of failure | Casual puzzle games | The single best earner in casual games |
| One wallet, daily reward, many places to spend | The arcade hub studied in `docs/research/` | A currency only works when it always has somewhere to go |
| Every match is an invite to a friend | Messaging-app games | Growth that costs nothing |
| Scores checked by the server; one verified human, one account | GameArena already | The reason a money leaderboard can be trusted here |

## 3. What a player sees

1. **Energy.** 5 ranked plays a day, free. A GoodDollar-verified player gets 8. It refills every day.
2. **Game of the day.** One game each day carries the pot. It rotates, so every day is a different contest.
3. **The pot.** A number on the home screen that grows all day as people play: "Today's pot: 42,300 G$ · 7 hours left".
4. **Play.** A ranked run in the game of the day enters you. There is no separate "enter" step: playing is entering.
5. **Out of energy?** Wait for tomorrow, or buy more: 5 plays for a small G$ price.
6. **The day ends.** The top third of players split the pot by rank. Winnings arrive in the wallet. A pot below the minimum rolls into tomorrow's, so a quiet day makes the next one bigger.

## 4. Where every G$ goes

For each G$ a player spends on energy:

| Share | Goes to | Note |
|---|---|---|
| 60% | That day's pot | Back to players |
| 20% | GameArena | Revenue |
| 20% | GoodDollar UBI pool | Exists today: the shop contract already sends 20% there |

These three numbers are the dials. They are a proposal, and the first thing to tune with real play.

The pot is also **seeded**. Today the treasury puts 126,000 G$ a week into the community challenge. That budget is redirected: about 18,000 G$ a day opens each pot, so the first player of the day already has something to play for. As player spending grows, the seed is reduced.

## 5. What is sold, and the one rule

**Sold: more tries. Never sold: a better try.**

| Item | Lane | Counts for the pot? |
|---|---|---|
| Energy (more ranked plays) | Ranked | Yes. More attempts at a best score, each one pure skill |
| Continue after a fail | Casual only | No. A continued run never reaches a prize board |
| Season pass (later) | Both | Rewards are energy, cosmetics, and entries, never score |
| Stablecoin packs in MiniPay (later) | Both | Bundles of the above, paid in dollars, in one tap |

A rich player can take more shots. They cannot buy a higher score. That is the line between a skill game people trust and a pay-to-win game people leave.

## 6. Why cheats and farms do not eat it

- **Only server-checked games carry the pot:** Rhythm Rush, Simon Memory, Word Ladder and Street Strike are replayed by the server from the player's own moves. Stack Tower is bounded and can join once its check is as strong. UP NEPA 3D never carries a pot.
- **Only GoodDollar-verified players are paid.** One human, one account. Anyone can play; a prize needs a verified wallet. This is what stops one person entering fifty times with fifty wallets.
- **Best score of the day counts, once per player.**
- **A minimum number of paid players** before a pot pays out; below it, the pot rolls over.

## 7. How the money moves (no new contract)

- **In.** Energy is sold through the shop contract that is already live (`PerkShop`): its owner can add a consumable item with a price, and it already splits each payment 80% to the treasury and 20% to the UBI pool. Energy is one more item. Nothing new is deployed, and nothing holds players' money in escrow.
- **Counted.** The server already reads every purchase from the chain into the database (`chain.ts`). The pot is a sum over the day's energy purchases. It is a row in a table, not a balance in a contract.
- **Out.** After the day closes, the server wallet sends each winner their share as a plain G$ transfer, and records each one in the payout ledger the admin dashboard already has.

The cost of this simplicity: between a purchase and a payout, the pot's G$ sits in the treasury wallet. Players are trusting GameArena to pay, as they already do for the weekly challenge. Every payout is on-chain and listed, so anyone can check the sums.

## 8. What it could earn

Illustration only, to show the shape. Assume 300 daily players and an energy pack of 5 plays for 100 G$:

| If… | Daily spend | To the pot | To GameArena |
|---|---|---|---|
| 1 in 10 buys one pack | 3,000 G$ | 1,800 G$ | 600 G$ |
| 1 in 4 buys one pack | 7,500 G$ | 4,500 G$ | 1,500 G$ |
| 1 in 4 buys two packs | 15,000 G$ | 9,000 G$ | 3,000 G$ |

In G$ this is small money. Its value is that it runs every day without anyone selling anything, and it grows in step with the number of players. Dollar revenue comes from the stablecoin packs (stage 3), which this stage makes possible.

## 9. Decisions the owner has to make

1. **The split.** 60 / 20 / 20 as above, or different.
2. **Energy.** 5 free plays a day (8 verified), and the price of a pack.
3. **The seed.** Redirect the weekly 126,000 G$ into daily pots, or keep the weekly challenge and seed less.
4. **Who is paid.** Verified players only (recommended), or everyone.
5. **Custody.** Accept that the pot sits in the treasury wallet until payout (no new contract), or pay for a contract with an audit.
6. **Law.** Paid entry with a cash prize is regulated in many places, Nigeria included. Skill games are usually treated more kindly than games of chance, but this needs a real opinion before stablecoin packs are sold. Nothing here is legal advice.

## 10. Build order

| Stage | What | Depends on |
|---|---|---|
| 1 | Energy, game of the day, the pot, daily payout, home-screen pot, admin page for it | Decisions 1 to 5 |
| 2 | Continue in every game, on the casual lane | Stage 1 live |
| 3 | Stablecoin packs in MiniPay | Decision 6 |
| 4 | Season pass | A steady daily base |

## 11. What this replaces, and what it does not

- It replaces the weekly community pool as the main reason to play today.
- It does not replace friend rooms, the leaderboards, or the shop's cosmetics. Friend rooms feed it: a friend who joins a room is a player who sees the pot.
- Sponsors can still add to a pot ("today's pot doubled by…"). That becomes a bonus, not the plan.

## 12. How we will know it works

Watched on the admin dashboard, daily: players who used all free energy, players who bought energy, G$ spent, pot size, share of players who came back the next day. The one number that matters most is **players who return the day after they first played for a pot**.
