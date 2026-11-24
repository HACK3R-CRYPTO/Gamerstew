# The Score Path. Architecture + Status

> How a finished run becomes an on-chain score, a leaderboard row, XP and a mission tick, and what the app reads now that the subgraph has stopped.
>
> Status: LIVE on the backend deployed from branch `nepa-up-light`. Author: GameArena · Updated 2026-11-24

---

## 1. The rule

Every ranked round is an on-chain transaction, and the player pays no gas. Prizes count confirmed on-chain scores only.

## 2. The three steps

1. **Start** (`POST /api/start-game`). The server writes a single-use ticket in `game_sessions` for this wallet and game. For games it deals (Word Ladder, the old 2D UP NEPA) the ticket fixes the round.
2. **Check and record** (`POST /api/sign-score`). The phone sends the run itself: taps, moves, drops or throws. The server works out the score it will accept (section 3), then sends `recordScore(player, gameType, score)` on the GamePass contract from the validator wallet and stores the transaction hash on the ticket. If the daily gasless budget is used up, it returns a signed EIP-712 voucher and the player submits the transaction.
3. **Save** (`POST /api/submit-score`). Writes the activity row, XP, mission progress, achievements, streak, and returns the rank.

Result screens wait for the transaction's receipt and show confirming, confirmed or failed, with a link.

## 3. What "checked" means, per game

| Game | On-chain id | Check | Server's own score |
|---|---|---|---|
| Rhythm Rush | 0 | Tap log replayed against the song | Yes |
| Simon Memory | 1 | Taps replayed against the dealt pattern | Yes |
| Stack Tower | 2 | Bounded by the drop log, humanness check | Bounded |
| Challenge AI | 3 | Played on the server, commit-reveal | Yes |
| UP NEPA (2D, retired) | 4 | Bank events replayed | Shadow mode |
| Word Ladder | 5 | Server deals the ladders and replays the words | Yes |
| Street Strike | 6 | Every throw replayed through the same physics | Yes |
| UP NEPA 3D (Restore the Light) | 7 | Server's clock, impossible finishes refused, skill bounded | Plausibility |

Charge Rush in UP NEPA 3D is not ranked. `SCORE_ENFORCE` lists the games whose score is cut to the server's figure. More in `games-backend/ANTICHEAT.md`.

High scores are not capped.

## 4. A run is saved once, and always

The save used to depend on the phone making the third call. A phone that lost its connection after step 2 left a score on the chain with no XP, no mission tick and no board row. That happened to a real Word Ladder run on 24 November.

- Step 2 stores the transaction on the ticket (`tx_hash`).
- Step 3 claims the ticket (`saved_at`) before saving. A second call for the same run is answered `already: true` and changes nothing.
- A job, `finishUnsavedRuns`, runs every two minutes and finishes the save for any run that has a transaction and no `saved_at`. It recovered the lost run.

Writes to the score, activity and mission tables no longer fail silently. A failure logs a line starting `🚨`.

## 5. What the app reads

The Goldsky subgraph stopped indexing on 30 October 2026 (last block 81,592,138). Nothing in the logs said so, and boards went stale for three weeks.

| Read | Source now |
|---|---|
| Weekly board per game, with transaction links | Our record of confirmed runs (`game_sessions`, `activity`), aggregated in SQL |
| Rank shown after a save, "you were passed" | Same |
| Activity feed | `activity`, newest first |
| Close-rank alerts | Same boards |
| Weekly community challenge count | `game_sessions` |
| All-time totals on home | Subgraph totals plus runs saved since its last block |
| Best score per game on passport and profile | The GamePass contract directly |
| Past seasons, cup, all-time combined ladder | Subgraph (stale) |

The subgraph is the fallback wherever our own record cannot answer.

## 6. Cost control

Supabase egress is metered per table (`src/platform/egress.ts`, shown at `/internal/metrics`). Boards are aggregated in the database, cached for 20 seconds on the server and at the edge, and screens that poll stop while the tab is hidden.

## 7. The outbox (built, off)

`SCORE_OUTBOX=true` makes step 2 answer at once and send transactions from a queue in batches. It is off. Before switching it on: check it against stake payments for nonce clashes, and merge to main.

## 8. Files

`games-backend/src/modules/scores/` (rules, service, submit, adapters), `src/modules/board/`, `src/modules/outbox/`, `legacy/scores.js` (wiring and jobs). Frontend: `app/actions/game.ts`, `components/RunSaveStatus.tsx`, `components/TxStatus.tsx`.

## 9. Open

- Decide the subgraph's future: redeploy or retire. Move the remaining reads either way.
- Rhythm Rush bests on the contract are from an older scoring scale (tens of thousands). A perfect song now scores under 1,000, so those all-time bests cannot be beaten.
- Simon achievements earned under the old, free thresholds were left in place.
