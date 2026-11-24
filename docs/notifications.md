# Notifications. PRD + Architecture + Status

> An inbox in the app that the server keeps, and optional web push on top of it.
>
> Status: inbox BUILT and deployed from branch `nepa-up-light`. Several parts of a full notification system are not built (section 6). Author: GameArena · Updated 2026-11-24

---

## 1. Why

The bell used to show a list kept in the browser. It was different on every device, nothing could be deleted, and GameArena had no way to tell every player something.

## 2. What a player gets

- **Inbox.** The bell opens a sheet with two tabs: everything for you, and **From GameArena** for announcements. The badge counts unread items.
- **Read state on the server.** Read on one device, read on all.
- **Delete** one item, or clear all.
- **Push** (optional). Streak warnings in the pet's voice, rank alerts, achievements. Each category at most once a day.

## 3. Rank alerts

- *Passed*: someone took your place on a board.
- *Close*: the two players next to each other in a top five are within 10% of the higher score. Sent to both, once a day per game per direction.

Until 24 November these read the stalled subgraph, so they had stopped and never covered the newer games. They now read our own boards. The old rule for "close" was any gap under 1,000 points, written when Rhythm Rush scored in the tens of thousands; with today's scores it would have pinged every pair every day.

Every game is named in push copy: Rhythm Rush, Simon Memory, Stack Tower, Word Ladder, Street Strike, UP NEPA 3D, Up NEPA!, Challenge AI.

## 4. Architecture

| Piece | Where |
|---|---|
| Inbox rules and routes | `games-backend/src/modules/inbox/` |
| Routes | `GET /api/inbox/:address`, `GET /api/inbox/:address/unread`, `POST …/read`, `POST …/delete`, `POST /internal/announce` |
| Push templates and sending | `games-backend/lib/push.js` |
| Jobs (streak warnings, close-rank) | `games-backend/legacy/notifications.js` |
| Sheet and badge | `frontend/components/NotificationsSheet.tsx`, `app/actions/game.ts` (`inboxList`, `inboxUnread`, `inboxMarkRead`, `inboxDelete`) |

Migration: `games-backend/supabase-migrations/2026-11-24_inbox.sql` (run).

## 5. Sending an announcement

`POST /internal/announce` with the internal secret puts one message in every player's From GameArena tab. There is no form for it yet; it is called by hand.

## 6. Not built

- A setting per kind of notification, and a daily cap across kinds.
- Retry for a push that failed.
- Tracking whether a notification was opened.
- A form for announcements, and announcements also going out as push.
- A notification when a season is sealed.
- Stronger proof of who is reading an inbox on MiniPay.

## 7. Rules for copy

Player-facing text never mentions internal goals or programmes. Bad news is not broadcast. No product feature is named that does not exist.
