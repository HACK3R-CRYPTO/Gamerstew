# Day 1 update · what changed and why

Posted after the first night. Two things players reported publicly (teams
moving, recruits reading 0) and two scoring numbers that went up. Both
increases are disclosed because they change how the event scores, and a scoring
change nobody announced is how you lose a room.

Deliberately NOT in here: contrast, layout, CSS, env vars. Nobody experienced
those. A changelog of things players never saw reads as a list of reasons to
doubt the numbers.

Live at time of writing: red 239, blue 162, 13 of 160 bounty slots claimed,
3 recruiters on the board.

---

## WhatsApp (bold = *one asterisk*)

*Tug of War, day 1 update*

Everything below is live now.

*1. Teams stopped moving.*
Some of you changed side more than once last night. That was our bug, not
anything you did. The system was ordering players by how many games they had
played, so every time anybody finished a game the sides got dealt again. It is
fixed. Your team is now locked from the moment you qualify, and it will not
change again for the rest of the week.

*2. Recruits now count.*
The recruiter board was reading 0 for everybody, even people who had already
brought verified players. Also our bug. Fixed. Open your page and your people
are there.

*3. Two numbers went UP.*
Bringing someone: 10 pts, now *20 pts*
Full rate scoring: 5, now *10 points a day*

Nothing was removed. Every score was recalculated on the new numbers, so
nobody has to replay anything.

*Where it stands*
Red 239, Blue 162
13 of the 160 bounty slots are gone. 147 left at 2,500 G$ each.

*What to do*
Verify, play 3 games, you are pulling. Bring somebody and you get 20 points
wherever the system puts them.
gamearenahq.xyz/tug

---

## Telegram (bold = **two asterisks**)

**Tug of War, day 1 update**

Everything below is live.

**Teams stopped moving.** Some players changed side more than once last night.
Our bug. The system was ordering players by games played, so every finished
game re-dealt the sides. Your team is now locked from the moment you qualify.

**Recruits now count.** The recruiter board read 0 for everyone, including
people who had already brought verified players. Fixed, and the board is live:
three recruiters are on it now.

**Two numbers went up.** Bringing someone is now 20 points, up from 10. Full
rate scoring runs to 10 points a day, up from 5. Nothing was taken away and
every score was recalculated, so there is nothing to replay.

Standing right now: Red 239, Blue 162. 147 of the 160 guaranteed 2,500 G$
slots are still open.

gamearenahq.xyz/tug

---

## X

Day 1 of Tug of War is done and two things needed fixing.

Teams were being re-dealt whenever anyone finished a game. Locked now.
The recruiter board was counting nobody. Live now, 3 recruiters on it.

Bringing a verified player is now worth 20 points, up from 10.

147 of 160 guaranteed slots left.
gamearenahq.xyz/tug

---

## If someone asks "did I lose points"

No. Standings are rebuilt from chain data every time, so every score already
uses the new numbers. Nobody needs to replay anything and nobody lost a bounty
slot: those are held by when you qualified, not by team.

## If someone asks "why did my team change again this morning"

Fixing the ordering meant re-dealing the sides once, on the correct key. That
was the last time. Say so plainly rather than claiming nothing moved.

---

# Push notification

## Load the secret once per terminal session

```bash
export INTERNAL_SECRET=$(grep "^INTERNAL_SECRET=" "/Users/ogazboiz/code /hackathon/GameArenaCelo-/frontend/.env.local" | cut -d= -f2-)
export BACKEND=https://game-backend-production-6130.up.railway.app
```

```bash
[ -n "$INTERNAL_SECRET" ] && echo "secret loaded" || echo "SECRET MISSING"
```

## Check the slot count before you send

The body quotes a number, so read it first rather than trusting this file.

```bash
curl -sS "$BACKEND/api/tug" -H "x-internal-secret: $INTERNAL_SECRET" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['bounty']['slots']-d['bounty']['claimed'], 'slots left')"
```

## Send it, evening WAT

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 Recruits now pay double",
    "body": "Bringing a verified player is 20 points, up from 10. Recruits are counting again. 147 of 160 guaranteed slots still open.",
    "url": "/tug",
    "tag": "tug-day1-boost"
  }'
```

Expected:

```json
{"success":true,"sent":29,"skipped":0,"cleaned":0}
```

---

# Commentary

## Why this push leads with points, not with an apology

Push is the one channel a player cannot mute selectively, which is why the rule
in `posts.md` is one a day. That makes the question "what is the single most
valuable thing this notification can say", and the answer is never "we fixed
some bugs".

Most of the people holding those ~29 devices never saw either bug. They did not
watch their team flip and they never opened the recruiter board. Leading with
"teams were moving and recruits were not counting" tells them, for the first
time, that the scoreboard they are playing against has been wrong. That is
manufacturing doubt in a room that currently has none.

The people who DID hit the bugs are the ones who complained in WhatsApp. They
are already in the room where the full explanation goes. They get the detailed
version in the channel where they raised it, which is also where they can reply
and be answered. Push cannot hold a conversation.

So the split is: push carries the thing that makes someone open the app today,
which is that recruiting is now worth double. The group chats carry the
accounting.

## Why "up from 10" stays in the body

It would read more cleanly without it. It stays because the old number was
published, in the rules, in the WhatsApp copy and in the X thread. A player who
remembers 10 and sees 20 with no explanation assumes the number is unstable and
therefore that the payout might be too. Naming the change costs six words and
closes that door.

## Why there is no cron collision today

`sendTugNotifications` fires on windows, and none are open:

- `tug_eve` needs 23 to 25 hours before the start. Passed.
- `tug_live` needs the first 2 hours after the start. Passed.
- `tug_lastday` needs 23 to 25 hours before the end, so around 29 September.
- `tug_bounty_low` needs 30 or fewer slots left. There are 147.

Checked before writing this. If you send on a later day, check again, because a
manual broadcast and the cron use different paths and will both land. The cron
de-dupes itself per wallet per category per day; it does not know about anything
you send by hand.

## Timing

Evening, WAT. The same reasoning as the launch push: this one asks for an action
that takes about ten minutes (open, share a link, play), and a notification read
during work gets cleared, not acted on. It also lands while the group chats are
active, so the push and the WhatsApp message reinforce each other instead of
arriving twelve hours apart.

## What NOT to push

Do not send a second push about the team fix. If enough people ask in the
groups, answer in the groups. A follow-up push saying "your team is stable now"
reaches mostly people who never knew it was unstable, and spends the one send
you get for the day on reassurance nobody asked for.

## In-app reach is larger than the push number

A broadcast also writes one `notifications_feed` row with a null wallet, so
every player sees it in the bell next time they open the app, not just the ~29
push subscribers. The `sent` number in the response undercounts real reach.
Judge the send by app opens, not by that figure.
