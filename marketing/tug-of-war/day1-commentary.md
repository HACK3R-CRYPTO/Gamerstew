# Day 1 commentary

Match report, not a changelog. The job is to make someone who has not opened
the app since verifying feel like they are missing something.

Numbers at time of writing, pulled live:
red 239, blue 193, red leads by 46, 7 humans each, today red 13 blue 11,
14 of 160 bounty slots claimed, top recruiter DeTalented on 4, 6d 12h left.

Re-read them before posting. A commentary post with a stale scoreline is worse
than no post.

---

## WhatsApp (bold = *one asterisk*)

*🪢 DAY 1 ON THE ROPE*

*RED 239 · BLUE 193*
Red leads by 46.

Blue were 77 behind this morning. They have pulled it back to 46 while most of
you were asleep. Today alone: Red 13, Blue 11. That is as close as it gets.

*The teams are dead level.* 7 verified players on each side. Nobody is
outnumbered. Whoever shows up decides this.

*One name is carrying Red.* @DeTalented has brought 4 verified players. That is
80 points sitting on Red's side of the rope from recruiting alone, and Red's
whole lead is 46. One person doing the work is the difference in this match
right now.

*146 slots still open.* 14 people have claimed their 2,500 G$. The other 146 are
sitting there. That money is not attached to winning. Verify, play 3 games,
it is yours.

6 days 12 hours left.
gamearenahq.xyz/tug

---

## Telegram (bold = **two asterisks**)

**🪢 DAY 1 ON THE ROPE**

**RED 239 · BLUE 193.** Red by 46.

Blue were 77 down this morning and have closed it to 46 overnight. Today's
split is Red 13, Blue 11. Nothing is settled.

The sides are level at 7 verified players each, so this is not about numbers.
It is about who turns up.

The interesting part: **@DeTalented has brought 4 verified players.** At 20
points each that is 80 points on Red's rope from one person recruiting, against
a total lead of 46. Take his recruiting out and Blue are in front.

**146 of the 160 guaranteed slots are still open.** 2,500 G$ each, paid whether
your side wins or loses. 14 gone so far.

6 days 12 hours to go.
gamearenahq.xyz/tug

---

## X

Day 1 on the rope.

RED 239 · BLUE 193.

Blue were 77 down this morning. They have closed it to 46.
Both sides sit on exactly 7 verified players.

One recruiter has brought 4 people. That is 80 points on Red's side.
Red's entire lead is 46.

146 of 160 guaranteed slots still open.
gamearenahq.xyz/tug

---

## Push

```bash
export INTERNAL_SECRET=$(grep "^INTERNAL_SECRET=" "/Users/ogazboiz/code /hackathon/GameArenaCelo-/frontend/.env.local" | cut -d= -f2-)
export BACKEND=https://game-backend-production-6130.up.railway.app
[ -n "$INTERNAL_SECRET" ] && echo "secret loaded" || echo "SECRET MISSING"
```

Read the live scoreline into the body instead of trusting this file:

```bash
curl -sS "$BACKEND/api/tug" -H "x-internal-secret: $INTERNAL_SECRET" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
r,b=d['red'],d['blue']
ldr='Red' if r>b else 'Blue' if b>r else 'Level'
print(f\"{ldr} leads by {abs(r-b)}  |  RED {r} BLUE {b}  |  {d['bounty']['slots']-d['bounty']['claimed']} slots left\")"
```

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 Red 239, Blue 193",
    "body": "Blue closed 31 points overnight and the sides are level at 7 each. Your best run today still moves it.",
    "url": "/tug",
    "tag": "tug-day1-report"
  }'
```

---

# Commentary on the commentary

## Why the scoreline leads

Nobody opens an app because a company posted an update. They open it because
something is happening without them. The scoreline is the only line that does
that work, so it goes first, in the title of the push and the first line of
every post.

## Why the closing gap is the story, not the lead

Red being ahead is a fact. Blue cutting 77 to 46 overnight is a story, and it is
the one that gets both sides to move. Red reads it as a lead slipping. Blue
reads it as a comeback that is already working. A post that only says "Red are
winning" tells Blue they have lost and tells Red to relax.

## Why name the recruiter

The top three are already public on the board, so nothing is being exposed. It
does three things at once: it rewards the person doing the most work, it shows
everyone else that recruiting is what actually moves the rope, and it gives the
match a character. Leaderboards with names on them get checked. Anonymous ones
do not.

The "80 points against a 46 lead" line is the single most persuasive thing in
the post, because it is arithmetic rather than a claim. State it as what it is,
80 points from his recruiting, and let people draw the conclusion.

## Why the 146 slots come last but always come

The bounty is the safety net that makes the event worth entering for somebody
who knows they will not top any board. It belongs at the end, after the drama,
phrased as money already sitting there rather than a prize to be won. "Not
attached to winning" is the whole point of it and has to be said every time,
because it is the part people keep missing.

## Cadence

Post this kind of report when the scoreline has actually moved, not on a
schedule. A daily report that says the same thing trains people to skip it. If
the gap swings, the lead changes hands, or the slots cross a round number, that
is a post. Otherwise stay quiet and let the group talk.

## What to do when Blue takes the lead

Post it within the hour, and make the title the lead change itself. A lead
changing hands is the highest value moment this event will produce and it is
worth breaking the cadence rule for.
