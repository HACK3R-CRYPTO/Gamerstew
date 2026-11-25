# docs

What each document is, and whether it describes the code as it is today.

## Current

| Document | What it covers |
|---|---|
| [score-path.md](score-path.md) | How a run becomes an on-chain score, a board row and XP; what each game's check is; what reads the subgraph and what no longer does |
| [friend-rooms.md](friend-rooms.md) | Rooms in every skill game, on-chain room rounds, G$ entry by permit |
| [friends-and-watching.md](friends-and-watching.md) | The friends list, inviting a friend into a room, watching a room live, and the guest limit on every game |
| [world-on-phones.md](world-on-phones.md) | UP NEPA 3D on phones: why it was not sharp, the camera and stick, and the small-screen fixes |
| [business-model.md](business-model.md) | PROPOSED: the Daily Pot. Players buy plays, the day's spend is the day's prize, the house keeps a share. Decisions waiting on the owner |
| [sign-in-costs.md](sign-in-costs.md) | PLAN: new email sign-ups move from Privy to Magic, own wallets sign in directly, old Privy players stay. Not started |
| [notifications.md](notifications.md) | The inbox, push, rank alerts, and what is not built |
| [../games-backend/ANTICHEAT.md](../games-backend/ANTICHEAT.md) | What is enforced per game, and what is not |
| [admin-dashboard.md](admin-dashboard.md) | The admin dashboard at `/admin`: what it shows, where each number comes from, how to turn it on, and what is still missing |
| [engagement-rewards.md](engagement-rewards.md) | What was committed to GoodDollar for engagement rewards. Not integrated |

## Design documents, with a dated note where things have changed

| Document | Note |
|---|---|
| [upnepa-3d-prd.md](upnepa-3d-prd.md) | UP NEPA 3D. Update of 24 November 2026 at the top |
| [nepa-up-light-prd.md](nepa-up-light-prd.md) | The first, 2D UP NEPA (game id 4). No longer linked from home |
| [duel-rooms/spec.md](duel-rooms/spec.md), [duel-rooms/nfr.md](duel-rooms/nfr.md) | Friend Duels on DuelEscrow. Superseded by friend rooms |
| [arena-cup-spec.md](arena-cup-spec.md) | The 3-Week Cup |
| [research/](research/) | Design research |

## History

[archive/](archive/) and [GOODBUILDERS_S5_APPLICATION.md](GOODBUILDERS_S5_APPLICATION.md) are records of what was planned or submitted at the time. They are not updated.

## Not written yet

Word Ladder and Street Strike have no design document. Their rules are described in the code: `games-backend/src/modules/ladder/rules.ts`, `games-backend/src/modules/strike/game.ts`, `frontend/app/bowling/Game.tsx`.

## Pictures

[screenshots/](screenshots/) holds the screens used in the READMEs, captured from the app at phone size. Retake them when a screen changes: the script that took them drives a local dev server with a headless browser.

## How we write these

Title, then a two-line summary and a status line with the date. Numbered sections: why, goals, design, architecture with file paths, risks and open decisions, current status split into built, not yet seen, and next. Say what was not tested. Plain sentences.
