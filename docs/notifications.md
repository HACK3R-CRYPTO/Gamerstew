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

## Telling players what is new (added 2026-11-26)

A release used to merge and nobody was told. Now one command does it, and the message reaches players in three places.

**1. Send it, from the admin.** Admin, Announce (`/admin/announce`). Write the title and the text, pick the page its button opens, add a push if you want one, and the page shows the pop-up and the push exactly as players will get them. The Send button stays off until the lengths fit and the box "Everything in this message is live" is ticked. An Admin or a Super Admin can send; an Analyst can write and preview. The same message cannot go out twice, every send is written to the admin log, and the page lists what was sent before. Code: `frontend/app/admin/(in)/announce/`, `announce()` in `games-backend/src/modules/admin/service.ts`.

Nothing about the admin reaches players: the message is what was typed, and its button can only open a page of the app, never the dashboard and never another site.

**Or from a terminal.** After a release is live on gamearenahq.xyz:

```bash
./scripts/whats-new.sh "<bell title>" "<bell text>" "<push title>" "<push text>" /dashboard short-name
```

It prints exactly what will go out, waits for `yes`, then posts the in-app message (`/internal/announce`, kind `whats_new`) and the push (`/api/push/broadcast?bell=0`). The push used to write its own line into the bell as well, so news sent both ways was listed twice; `bell=0` (and the admin page) send the push without it. The short name stops the in-app message being posted twice. Write the bell text as short sentences: each becomes one line in the pop-up.

**2. The pop-up.** The next time a player opens the home screen, the message arrives as a letter: their slime pops out of an envelope with the title, the points one to a line, "Show me" (goes to the page the message names) and "Later". `frontend/components/WhatsNewModal.tsx`, reading the public `GET /api/whats-new`.

A pop-up interrupts, so it keeps to rules:

- only on the home screen, never inside a game
- once per message per device, and only for news under two weeks old
- a first-time visitor gets none: everything is new to them
- it waits for the page to settle and never opens over another sheet
- Later, the X, a tap outside and Escape all close it

**3. The bell.** The same message stays under "From GameArena" until the player deletes it. The pop-up says so.

Counted for the admin (Visits, Events): `whatsnew_shown`, `whatsnew_open`, `whatsnew_closed`.

The social posts that go with a release are written at the same time and kept, with their pictures, in `marketing/whats-new-<date>/` (not in git).

## Push: what was wrong on 2026-11-26, and what changed

The first announcement sent from the admin said the push "went to 0 devices". The news itself was delivered to every bell. The push was never attempted: the admin's sender reached the push code by a name that exists only in the first part of the server file, so it threw, and the throw was swallowed as a zero.

- **Fixed**, and a sender that breaks is now reported as broken, on the page and in the log.
- **The admin page says who a push can reach** before sending ("30 phones have notifications switched on") and afterwards what became of each: got it, had news switched off, had expired, or was refused and why.
- **"Only the push"** sends a push for news that is already in the bell.
- **A hole closed.** A push is a request from this server to the address in a subscription. Two entries in the table pointed at internal addresses (a cloud metadata address and a local database port), left from before the sign-up route was locked in July. Only the browsers' own push services are accepted now, when a subscription is saved and again before anything is sent; anything else is never contacted and is removed. `isPushEndpoint` in `games-backend/lib/push.js`.
- **Turning notifications on.** The ask only appeared after a saved run in four games, once per device, and nobody had signed up since 5 October. The bell now has a "Turn on" row for anyone who has not decided yet.

`GET /internal/push/devices` (internal secret) reports the phones signed up, how many are muted, which push services they use, and whether each sign-up is well formed, without sending anything.
