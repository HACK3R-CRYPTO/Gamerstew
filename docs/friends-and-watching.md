# Friends, watching a room, and the guest limit

Three things that make playing together easier. All three shipped on 2026-11-24.

## 1. Friends

A signed-in player keeps a list of friends.

| The player wants to | How |
|---|---|
| Add someone | On `/friends`, type the start of their name: matching players appear as you type, each with an Add button that turns to "Requested ✓" at once. Or send your friend link on WhatsApp (`/friends?add=0x…`): it opens as one card with one button, and survives sign-in. Or tap "Add friend" on their passport |
| Answer a request | Accept or Decline on `/friends`. A request also arrives as a notification |
| Play with a friend | Open a room in any game, tap "Invite a friend", tap Invite beside their name |
| Remove a friend | The ✕ beside their name, then Remove. The other player is not told |

The Friends page opens from the profile ("👥 Friends").

### Where friends show up

| Place | What the player sees |
|---|---|
| Home | A row under the greeting: friends' faces with a green dot on the ones online, "2 online now", and a badge for waiting requests. With no friends it says "Add friends" |
| "Play with friends" sheet | "2 friends are online", each with an Invite button. One tap opens the room and sends the invite |
| Inside a room | The invite list, open from the start, online friends first |
| Beside each player in a room, in the lobby and on the result card | "+ Add friend", "Accept friend", "Requested ✓" or "Friend ✓". This is how two people who met by a room code become friends |
| Friends page | The full list. On a wide screen it uses the normal top bar and two columns |

A room tells its own players which seats are signed in (a public address), so they can add each other. A spectator is never told.

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

### Meeting players who are not your friends

The Friends page has three tabs: **Friends**, **Online now** and **Requests**.

- "Online now" lists every signed-in player with the app open, friend or not, each with an Add button. A new player with no friends has people to add without knowing a name.
- The page opens on Requests when one is waiting, and on Online now when the friends list is empty.
- The tab layout follows the pattern players already know from chat apps (friends, online, pending), with the list of everyone as the default so offline friends are not hidden.

### Room chat

Players in a room can talk: in the lobby once a second player is in, and on the result card. Six quick replies sit above the text box. People watching can read the chat and cannot write in it.

- A line is at most 140 characters. Tags and control characters are removed.
- One line every 0.7 seconds per player. The room keeps its last 40 lines.

## 2. Watching a room

Anyone with a room code can look on without playing.

- **A watcher sees the game itself.** While a round is played, each game sends a few numbers about its screen with its progress (`room.progress(n, live)`). The watch page draws the game from them (`components/LiveBoard.tsx`): Stack Tower's tower growing, Word Ladder's tiles turning green, Simon's pad on its round, Rhythm's combo, UP NEPA's shops lighting. It is a picture of the play, not a video, so it costs almost nothing to send.
- **Stack Tower is shown as the real game.** After every drop the player's phone sends the top of its real tower: where each block sits, how wide it was cut, its screen width, and how fast the next block slides. The watch page rebuilds the tower with the game's own block painter (`lib/stackDraw.ts`, `components/StackReplay.tsx`), so a watcher sees the real overhangs and the real narrowing, drop by drop. The block sliding between drops is the watcher's own animation at the real speed; where each block lands is the player's.
- **Rhythm Rush is shown as the real song.** A little more than once a second the player's phone sends its clock and the tiles around the hit line: lane, when each reaches the line, how long it falls, how long it is held, and whether it was missed. The watch page lets them fall between messages on the player's clock, in the game's lane colours (`components/RhythmReplay.tsx`). A played tile bursts on the line; a missed one falls through, dimmed. Perfect and good are not told apart.
- The Watch list (`/watch`) keeps the room-code box beside the title, so it is in reach however long the list is. Rooms are cards in a grid (three across on a desktop), with a chip per game to cut the list down.
- **Simon Memory is shown as the real pad.** The player's phone sends the pattern when it starts being shown, with the game's own flash and gap times, then a message for every pad pressed. The watch page plays the pattern through at that speed and lights each press in order (`components/SimonReplay.tsx`). A wrong press lights the pad that was pressed, in red, and the pad shakes. Presses that arrive together are played one after another, so none is skipped.
- Known trade-off: everyone in a Simon room has the same pattern, so a player with a second screen could watch a rival's pad. It is shown anyway, by the owner's decision (2026-11-25): each player is shown the same pattern on their own screen, and for rooms played for G$ this should be looked at again.
- The watch page is pushed the room over the live line (below). Asking once a second is only the fallback.
- Only numbers are accepted, at most 8 fields, so nothing a player types can reach a watcher's screen that way.
- Word Ladder shows which letters are in place and never the letters. Everyone in a room has the same words, so the letters would hand a rival the answer.
- The watch page is laid out like a match: the game and clock across the top, one panel per player (score, live game, who is leading), chat beside them. It uses the shared top bar and the full width on a desktop.
- `/watch` lists the rounds being played right now, busiest first. Tap one to watch. No code is needed.
- Each room has a second, public "watch name". The live list and the "Watch link" button use it. It lets anyone look on and can never be used to join, and a room's code never appears in the list or on a page reached from it.
- Only a round in play between at least two people is listed.
- The home page shows "2 rounds live · Watch" when there is something to see.
- `/watch/CODE` still works for a friend who has the code. It shows the game, whether the round is live, each player's progress and score, the winner, and how many people are watching.
- The room sheet has a "Watch link" button beside the invite.
- A watcher is shown names, progress and scores. A watcher is never sent the round's deal, so watching cannot help a player.
- The page asks the room for its state every 1.5 seconds, and only while the tab is visible.
- The watcher count is everyone who looked in the last 8 seconds. It is not saved: a restart starts the count again.

It covers the five games that use shared rooms: Rhythm Rush, Simon Memory, Stack Tower, Word Ladder and UP NEPA 3D. Street Strike has its own rooms and cannot be watched yet.

Code: `games-backend/src/modules/rooms/service.ts` (`get` with a watcher, `watching`, `goal`), `frontend/app/watch/`.

## The live line (how a room reaches every screen at once)

A room is pushed to phones over a socket the moment it changes. Nobody asks for it.

**Before:** every phone asked the server for the room about once a second. A move could take over a second to show on another screen, and a fast player's taps could arrive in a lump.

**Now:** the phone opens one socket to the game server and says which room it is in or watching. When a block lands, a pad is pressed, a line of chat is sent or a score comes in, the server sends the room to every phone on that room at once. Measured on one machine: under 2 ms from a player's move to a watcher's screen.

| Message | Who sends it | What it is |
|---|---|---|
| `hello` with a room code and seat key | a player | "I am in this room" |
| `hello` with a watch name (or a code) | a spectator | "I am watching this room" |
| `p` | a player | their screen, as numbers |
| `say` | a player | a line of chat |
| `room` | the server | the room, as that phone is allowed to see it |
| `gone` | the server | the room has closed |

### What stays the same

- Each phone is sent its own view. A player gets the round's deal. A spectator never does, and a spectator who came by the watch name is never told the code.
- A spectator's socket only listens. It cannot send progress or chat.
- Taking a seat, starting, finishing and playing for G$ still go through the ordinary routes, because they need a checked sign-in.

### When the line drops

The phone tries again after 1, 2, 4, then 8 seconds, for as long as the room is open. While it is down, the page goes back to asking once a second, so a weak connection slows a room and never stops it. With the line up, a player's page still asks every 8 seconds as a safety net. The watch page shows "⚡ Instant" while the line is up.

### Limits and safety

- The socket accepts only this site's own pages (the same list of origins as the rest of the server). On a Vercel preview address that is not on the list, pages fall back to asking.
- A connection can do nothing until it shows a valid seat key or watch name.
- 40 messages in any 2 seconds, 4 KB a message, 80 sockets a room, 5,000 in all. Past that the line is closed.
- A phone that vanishes is noticed within a minute and dropped.
- `GET /internal/live` (internal) says how many rooms and sockets are connected.

### What it does not do yet

One server holds every room in memory, so one hub reaches every phone. If the game server is ever run as two copies, the hubs need a shared channel (Redis is the usual choice) or phones on different copies will not see each other. Today there is one copy.

Code: `games-backend/src/modules/rooms/live.ts` (the hub, with tests), the socket itself at the end of `games-backend/legacy/notifications.js` (path `/live`), `frontend/lib/roomSocket.ts`, `frontend/app/api/live/route.ts`.

## 3. The guest limit

A visitor who has not signed in gets 3 free runs of each game. After that, starting another run opens the sign-in prompt.

- It now covers all seven games. Word Ladder, Street Strike and UP NEPA 3D had no limit before.
- Rounds in a friend room are never counted and never blocked, so a friend's invite always works.
- The count lives in the browser. It is a nudge to sign in, not a security control.
- The admin dashboard counts each time the limit is reached (`guest_limit_hit`).

Code: `frontend/hooks/useGuestGate.tsx` (the three newer games), `frontend/lib/guestLimit.ts`.

## How it was checked

- Backend tests: 361 pass, including friends (ask, accept, refuse, invite, remove) and spectators (not dealt the round, counted once).
- The friends flow was run end to end through the app's own route against a local server.
- A real local room with three players was watched from a phone-sized browser, through waiting, live and closed.
- Not yet checked: friends against the real database, and a real invite arriving on a phone.
