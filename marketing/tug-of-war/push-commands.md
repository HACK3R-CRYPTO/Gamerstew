# Tug of War push commands

Paste these in your terminal. Same shape as the broadcast example in
`games-backend/server.js`.

Reach: ~29 push devices, plus **every player** sees it in the in-app bell next
time they open the app (a broadcast writes one `notifications_feed` row with a
null wallet, so it is not limited to push subscribers).

---

## Load the secret once per terminal session

```bash
export INTERNAL_SECRET=$(grep "^INTERNAL_SECRET=" "/Users/ogazboiz/code /hackathon/GameArenaCelo-/frontend/.env.local" | cut -d= -f2-)
export BACKEND=https://game-backend-production-6130.up.railway.app
```

Check it loaded:

```bash
[ -n "$INTERNAL_SECRET" ] && echo "secret loaded" || echo "SECRET MISSING"
```

---

## 1. Announcement · send Tuesday evening, around 6-7pm WAT

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

## 2. Launch · Wednesday 6pm WAT, when the rope opens

```bash
curl -sS -X POST "$BACKEND/api/push/broadcast" \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🪢 The rope is live",
    "body": "Play 3 games and you are pulling for your side. Bring someone and they land on your team.",
    "url": "/tug",
    "tag": "tug-live"
  }'
```

---

## 3. Last day · the 30th

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

## What a successful send looks like

```json
{"success":true,"sent":29,"skipped":0,"cleaned":0}
```

- `sent` — devices that took the push
- `skipped` — players who muted promos
- `cleaned` — dead subscriptions removed automatically

---

## Notes

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
