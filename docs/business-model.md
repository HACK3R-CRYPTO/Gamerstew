# GameArena business model: the Daily Pot

> Status: PROPOSED on 2026-11-26, revised the same day after the owner's notes. **Everything is priced in G$. There are no dollar or stablecoin items.** Built so far: a continue that never buys or costs rank, a transaction for every unfinished run, and leaving a ranked round finishing it in every game (section 13). The pot, energy and the new items are not built, and wait on section 9.

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
| Streak freeze | Both | Keeps a streak alive through one missed day. Players pay to protect what they built |
| Pet care | Both | Feeds the pet so it keeps growing. The pet and its "sad" message exist already |
| Cup ticket | Ranked | Entry to a bigger weekly cup. The tickets are the prize |
| Season pass (later) | Both | Rewards are energy, cosmetics, and entries, never score |

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

In G$ this is small money per player. So the model leans on three things instead of a high price: many small reasons to spend each day (energy, a continue, a streak freeze, pet care, a cup ticket), every one of them a transaction on the chain, and a share of each kept by the house. Volume and habit, not a big ticket.

## 9. Decisions the owner has to make

1. **The split.** 60 / 20 / 20 as above, or different.
2. **Energy.** 5 free plays a day (8 verified), and the price of a pack.
3. **The seed.** Redirect the weekly 126,000 G$ into daily pots, or keep the weekly challenge and seed less.
4. **Who is paid.** Verified players only (recommended), or everyone.
5. **Custody.** Accept that the pot sits in the treasury wallet until payout (no new contract), or pay for a contract with an audit.
6. **Law.** Paid play with a prize is regulated in many places, Nigeria included. Skill games are usually treated more kindly than games of chance. G$ is a token with a market price, so this still deserves a real opinion once pots grow. Nothing here is legal advice.

## 10. Build order

| Stage | What | Depends on |
|---|---|---|
| 1 | Energy, game of the day, the pot, daily payout, home-screen pot, admin page for it | Decisions 1 to 5 |
| 2 | Continue in every game, on the casual lane | Stage 1 live |
| 3 | Streak freeze, pet care, cup tickets | Stage 1 live, and the shop items in section 14 set by the owner |
| 4 | Season pass | A steady daily base |

## 11. What this replaces, and what it does not

- It replaces the weekly community pool as the main reason to play today.
- It does not replace friend rooms, the leaderboards, or the shop's cosmetics. Friend rooms feed it: a friend who joins a room is a player who sees the pot.
- Sponsors can still add to a pot ("today's pot doubled by…"). That becomes a bonus, not the plan.

## 12. How we will know it works

Watched on the admin dashboard, daily: players who used all free energy, players who bought energy, G$ spent, pot size, share of players who came back the next day. The one number that matters most is **players who return the day after they first played for a pot**.

## 13. Three rules that are already in the code (2026-11-26)

**A continue never buys rank, and never costs it.** Stack Tower, Rhythm Rush and Simon Memory sold a continue only in ranked play, and the continued run went on the weekly board with everything added after it: money bought rank. Now a continue is offered in every solo mode. In a ranked run the score is banked at the moment of the continue, and that banked score is what goes on the board and the chain; what the player adds afterwards is for fun. The overlay says so before they pay ("Your ranked score stays at 1,240. What you add after is for fun."), and the result screen shows both numbers. There is no separate "continue mode" to pick first: the choice is made at the moment a run dies, which is the only moment anyone wants it. The purchase itself is a transaction. Code: `bankedRef` in each game's page, `components/SaveRunOverlay.tsx`.

**Every run a player opens is a transaction.** A run that was started and never finished used to leave nothing on the chain. Fifteen minutes after it starts, the server now sends a transaction for it: a note from its own wallet to itself that reads "GameArena · unfinished run · <game> · <player>". It is not a score on purpose: a zero score counts as a game played, the weekly challenge pays by games played, and players could earn by opening and closing games. Limits: 8 a pass, 20 a player a day, 1,500 a day. Code: `games-backend/src/modules/scores/unfinished.ts`. Switch: `UNFINISHED_ONCHAIN`. The dashboard link needs `2026-11-26c_unfinished_tx.sql`.

**Leaving a round finishes it.** A ranked round a player walks out of is ended and handed in, after one question ("End this game?"), instead of being thrown away:

| Game | What leaving does |
|---|---|
| Word Ladder | Unsolved ladders are handed in as skipped; the server scores what was solved |
| Street Strike | Throws not made count as misses; the server replays the throws that were made and closes the card (`endedEarly`) |
| UP NEPA 3D | The breakers lit so far are handed in as an unfinished round, which the server already scores |
| Rhythm Rush, Simon Memory | QUIT has always ended the run with the score so far |
| Stack Tower | No way out mid-run except closing the page |

In every game, a round left with nothing scored is not handed in, so opening and closing a round is not a game played. It still gets the unfinished-run transaction above.

## 14. Shop items the owner has to switch on

The live shop contract sells items 1 to 6. Its owner is `0x2E33…7Ad1`, and only that wallet can add an item, by calling `setPerk(id, price in wei, false)` on `0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5`.

The app reads the price from the contract (`hooks/useLivePerk.ts`). An item with no price is never offered, so an item can be built and shipped before it is switched on, and the owner can change a price without an app release.

| Id | Item | State | Proposed price |
|---|---|---|---|
| 9 | UP NEPA 3D: one more life | **Built, waiting to be switched on** | 100 G$ |
| 10 | Energy: 5 more ranked plays | Not built | 100 G$ |
| 11 | Streak freeze | Not built | 150 G$ |
| 12 | Pet food | Not built | 30 G$ |

To switch on item 9 at 100 G$, the owner wallet sends, on Celo:

```bash
cast send 0xe451Ab21587e6Fd540522495CbaE62dD0f207Ef5 "setPerk(uint16,uint256,bool)" 9 100000000000000000000 false --rpc-url https://forno.celo.org --private-key $OWNER_KEY
```

**One more life.** When the last life goes in a Restore round, the round is held: the clock, the breakers and the traffic all stop while the player decides (8 seconds). Taking the life gives one life back and three seconds of safety. One offer a round. In a ranked round the breakers lit before the extra life are what is handed in, the same rule as every other continue. Not offered to guests or in friend rooms. Code: `hold` in `app/world/restore.ts`, `takeLife` in `app/world/World.tsx`.

**Ids 7 and 8 are left free.** A paid hint in Word Ladder and a paid re-bowl in Street Strike were considered and dropped. A continue is fair when the run is already over: the score before it can be ranked and the rest is for fun. Neither game has that moment. A re-bowl in the middle of a ranked card, or a hint with no cost in points, would buy rank. Word Ladder already has free hints that cost points. What those two games can sell fairly is access, not help: energy and cup tickets.
