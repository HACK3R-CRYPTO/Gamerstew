# Friends, watching a room, and the guest limit

Three things that make playing together easier. All three shipped on 2026-11-24.

## 1. Friends

A signed-in player keeps a list of friends.

| The player wants to | How |
|---|---|
| Add someone | Type their GameArena name on `/friends`, or share "my friend link" (`/friends?add=0x…`) |
| Answer a request | Accept or Decline on `/friends`. A request also arrives as a notification |
| Play with a friend | Open a room in any game, tap "Invite a friend", tap Invite beside their name |
| Remove a friend | The ✕ beside their name, then Remove. The other player is not told |

The Friends page opens from the profile ("👥 Friends").

### Who is online

A friend with the app open shows a green dot and "Online". Otherwise the row says when they were last active ("Active 5m ago"). Online friends come first, on the Friends page and in a room's invite list.

- A signed-in player's app checks in once a minute while the tab is visible (`components/Presence.tsx`). Guests send nothing.
- A player counts as online for 2.5 minutes after their last check-in.
- Only accepted friends see it. Someone who has only sent a request learns nothing.
- It is held in the server's memory, not the database. A restart forgets it, and it fills again within a minute.

### How it is stored

One row per pair of players in `friendships`. The lower address is always column `a`, so the same two players can never be recorded twice. `asked_by` is who sent the request. The database itself refuses a row that is out of order, has a bad status, or is marked accepted with no date.

Migration: `games-backend/supabase-migrations/2026-11-26_friends.sql`. Until it is run, the Friends page says friends are not available.

### Rules the server keeps

- The wallet a request acts as comes from the checked sign-in (`lib/server/roomWallet.ts`), never from the request body.
- Only the player who was asked can accept. Asking someone who already asked you counts as accepting.
- At most 200 friends and 30 unanswered requests.
- An invite needs an accepted friendship, a real game, and 30 seconds since the last invite to the same friend.
- An invite link can only point at a game's own page.
- Adding by name reads `chain_mints` (the server's copy of GamePass names). If that table is empty, adding by link still works.

Code: `games-backend/src/modules/friends/` (service, adapters, routes, tests), `frontend/app/api/friends/[action]/route.ts`, `frontend/hooks/useFriends.ts`, `frontend/app/friends/page.tsx`, `frontend/components/InviteFriends.tsx`.

**Known limit:** inside MiniPay there is no sign-in token, so the wallet is taken as given, the same trust a solo run has there. Nothing in friends moves money.

## 2. Watching a room

Anyone with a room code can look on without playing.

- `/watch` asks for a code. `/watch/CODE` shows the game, whether the round is live, each player's progress and score, the winner, and how many people are watching.
- The room sheet has a "Watch link" button beside the invite.
- A watcher is shown names, progress and scores. A watcher is never sent the round's deal, so watching cannot help a player.
- The page asks the room for its state every 1.5 seconds, and only while the tab is visible.
- The watcher count is everyone who looked in the last 8 seconds. It is not saved: a restart starts the count again.

It covers the five games that use shared rooms: Rhythm Rush, Simon Memory, Stack Tower, Word Ladder and UP NEPA 3D. Street Strike has its own rooms and cannot be watched yet.

Code: `games-backend/src/modules/rooms/service.ts` (`get` with a watcher, `watching`, `goal`), `frontend/app/watch/`.

## 3. The guest limit

A visitor who has not signed in gets 3 free runs of each game. After that, starting another run opens the sign-in prompt.

- It now covers all seven games. Word Ladder, Street Strike and UP NEPA 3D had no limit before.
- Rounds in a friend room are never counted and never blocked, so a friend's invite always works.
- The count lives in the browser. It is a nudge to sign in, not a security control.
- The admin dashboard counts each time the limit is reached (`guest_limit_hit`).

Code: `frontend/hooks/useGuestGate.tsx` (the three newer games), `frontend/lib/guestLimit.ts`.

## How it was checked

- Backend tests: 352 pass, including friends (ask, accept, refuse, invite, remove) and spectators (not dealt the round, counted once).
- The friends flow was run end to end through the app's own route against a local server.
- A real local room with three players was watched from a phone-sized browser, through waiting, live and closed.
- Not yet checked: friends against the real database, and a real invite arriving on a phone.
