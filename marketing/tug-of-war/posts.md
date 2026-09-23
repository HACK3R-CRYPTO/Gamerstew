# Tug of War launch posts

Images in this folder:
- `tug-x.jpg` 1200x675 for X
- `tug-square.jpg` 1080x1080 for feed posts
- `tug-story.jpg` 1080x1920 for Status and Stories

Link: https://gamearenahq.xyz/tug

---

## 1. X announcement (post with tug-x.jpg)

Tug of War starts Wednesday.

2,000,000 G$ in total. Two sides, one rope, seven days.

Every verified human on your side pulls.

Separate from that: the first 160 players to verify and play get 2,500 G$ each.
That one is a race, not a contest. You keep it even if your side loses the rope.

Verify now so you are ready on day one.

gamearenahq.xyz/tug

---

## 2. X thread (post the announcement first, then reply)

**2/**
Here is the part that decides it.

A verified human you bring is worth 20 points.
Your best day of playing is worth about 13, and only your best score counts.

Bringing one person beats a full day of playing. Recruiting wins this.

**3/**
Quitting earns nothing.

Points come from how well you play, not how many times you press start. Only
your best run each day counts. Restarting to farm does not work.

**4/**
You do not pick your side.

The system draws you Red or Blue and keeps the two sides even, so the teams
never end up 10 against 2. Nobody can move you afterwards, and your friends may
well be drawn against you. Bringing them still pays you 20 points either way.

**5/**
There is a second prize running alongside it.

500,000 G$ to whoever brings the most players. 300,000 and 200,000 for second
and third. A recruit only counts once they verify and play.

**6/**
Every player in this is a real person. One face, one player, checked by
GoodDollar.

No bots pulling the rope.

gamearenahq.xyz/tug

---

## 3. Telegram announcement (pin this)

🪢 **Tug of War starts Wednesday**

2,000,000 G$ across two prizes. Red against Blue for seven days.

- 1,000,000 G$ on the rope
- 1,000,000 G$ for the top recruiters

**How it works**
Verify once. Play 3 games. Now you are pulling for your side.

Every verified human you bring is worth 20 points. Your best run each day is
worth about 13. So bringing one person beats a whole day of playing.

**There are two prizes, and they do not affect each other**

1. **The race.** The first 160 players to verify and play get 2,500 G$ each.
   Nothing to do with your team or your score. Only how early you show up.
   Slot 161 gets nothing from this, so being early is the whole point.

2. **The rope.** Your team's total after seven days. The winning side splits
   more, the losing side still gets paid.

You can win one, both, or neither. Lose the rope and you still keep your 2,500.

**Top recruiter takes 500,000 G$**
Second gets 300,000. Third gets 200,000. A recruit only counts once they verify
and play, so bring real people.

**Do this today**
Verify before Wednesday. The 160 slots go in order, and a first face check takes
about 30 seconds. Turning up unverified on day one means the early slots are
already gone.

👉 gamearenahq.xyz/tug

---

## 4. WhatsApp group (send with tug-square.jpg)

WhatsApp bold is `*one asterisk*`, italic is `_one underscore_`. Markdown's
`**` renders literally on WhatsApp, so copy the blocks below exactly as they
are rather than reusing the Telegram copy, which does use `**`. Links
auto-link, do not wrap them in brackets.

```
🪢 *TUG OF WAR* starts Wednesday

*2,000,000 G$* in prizes. Red against Blue for seven days.

*How it works*
Verify once. Play 3 games. Now you are pulling for your side.

Every verified human you bring is worth 20 points. Your best day of playing is worth about 13. So bringing one person beats a whole day of playing.

*Get paid even if your side loses*
The first *160* players to verify and play get *2,500 G$ each*. That part is a race, not a contest. Your team and your score do not matter, only how early you show up. Once the 160 are gone they are gone.

*Top recruiter takes 500,000 G$*
Second gets 300,000. Third gets 200,000. A recruit only counts once they verify and play, so bring real people.

*Do this tonight*
Verifying takes about 30 seconds and you only do it once. Turning up on Wednesday unverified means the early slots are already claimed.

👉 gamearenahq.xyz/tug
```

### Shorter version, if the group is busy

```
🪢 *Tug of War* starts Wednesday. *2,000,000 G$*.

First *160* to verify and play take *2,500 G$ each*. It is a race, not a draw, and you keep it even if your side loses.

Verify tonight, it takes 30 seconds.
gamearenahq.xyz/tug
```

### Launch hour

```
🪢 *The rope is live.*

Play 3 games and you are pulling for your side. Anyone you bring joins _your_ team.

gamearenahq.xyz/tug
```

### Last day

```
🪢 *Last day on the rope.* Closes tonight.

Your best run today still counts. If you never claimed one of the 160 guaranteed slots, check whether any are left.

gamearenahq.xyz/tug
```

---

## 5. WhatsApp Status / Story (post tug-story.jpg)

Tug of War. Wednesday.
2,000,000 G$ in prizes.
First 160 to verify and play get 2,500 G$ each.
It is a race. Verify tonight.
gamearenahq.xyz/tug

---

## 6. Day-before reminder (X + Telegram)

Tug of War opens tomorrow.

The first 160 to verify and play take 2,500 G$ each, in order. Not a draw, not
a ranking. Once the 160 are gone they are gone.

Verifying takes about 30 seconds and you only do it once.

Do it tonight, not tomorrow.

gamearenahq.xyz/tug

---

## 7. Launch hour (X + Telegram)

The rope is live.

Pick up your first 3 games and you are pulling. Bring someone and they land on
your side.

gamearenahq.xyz/tug

---

## 8. Mid-event, only if one side is running away

Blue leads the rope. Red still wins today.

Today's score resets at midnight, so a side that is behind can take the day back
every single day.

gamearenahq.xyz/tug

---

---

## 9. Push notification commands

Paste these in your terminal. Same shape as the broadcast example in
`games-backend/server.js`.

Reach: ~29 push devices, plus **every player** sees it in the in-app bell next
time they open the app (a broadcast writes one `notifications_feed` row with a
null wallet, so it is not limited to push subscribers).

---

### Load the secret once per terminal session

```bash
export INTERNAL_SECRET=$(grep "^INTERNAL_SECRET=" "/Users/ogazboiz/code /hackathon/GameArenaCelo-/frontend/.env.local" | cut -d= -f2-)
export BACKEND=https://game-backend-production-6130.up.railway.app
```

Check it loaded:

```bash
[ -n "$INTERNAL_SECRET" ] && echo "secret loaded" || echo "SECRET MISSING"
```

---

### Announcement · send Tuesday evening, around 6-7pm WAT

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 Tug of War starts Wednesday",
    "body": "2,000,000 G$ in prizes. The first 160 to verify and play take 2,500 G$ each. Verify tonight.",
    "url": "/tug",
    "tag": "tug-announce"
  }'
```

Evening matters. A "verify tonight" push read at work gets forgotten; read at
9pm it gets acted on.

---

### Launch · Wednesday 6pm WAT, when the rope opens

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 The rope is live",
    "body": "Play 3 games and you are pulling for your side. Bring someone and you get 20 points, wherever they land.",
    "url": "/tug",
    "tag": "tug-live"
  }'
```

---

### Last day · the 30th

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 Last day on the rope",
    "body": "It closes tonight. Your best run today still counts.",
    "url": "/tug",
    "tag": "tug-lastday"
  }'
```

---

### What a successful send looks like

```json
{"success":true,"sent":29,"skipped":0,"cleaned":0}
```

- `sent`: devices that took the push
- `skipped`: players who muted promos
- `cleaned`: dead subscriptions removed automatically

---

## Notes for whoever posts this

- **The cron sends these too.** `sendTugNotifications` in `games-backend`
  fires the eve, launch, low-slots and last-day messages on its own once the
  event window is set on Railway. Only run these by hand if you want to send
  early, or if the backend is not deployed yet. Sending both is not harmful:
  `sendToWallet` de-dupes per wallet per category per day, but a manual
  broadcast uses a different path and WILL double up with the cron, so pick one.
- Do not send more than one push a day. Push is the one channel a player
  cannot mute selectively, and an event that pings daily gets muted before it
  starts.
- Check the prize figure is still correct before sending. Once it is out, it is
  public and walking it back costs trust.

---

- Every number here is read live from the event API. If you change the prize or
  the slot count, update these posts too.
- Do not promise a payout date. Payouts run after the event closes on the 30th.
- The 160 bounty slots are first come. Say "in order", never "random".
- Do not claim players cannot use more than one wallet. The honest claim is one
  face, one scoring player, which is what the verification actually enforces.
