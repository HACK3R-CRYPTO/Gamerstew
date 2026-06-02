# scripts

Utility scripts that don't belong inside the per-service folders. Run from the repo root unless noted.

## Contents

- **`test-anti-cheat.js`** · standalone exercise of the games-backend score-validation path. Submits synthetic score payloads against a running backend to verify that suspect durations, mismatched session keys, and replayed vouchers all get rejected. Useful when tweaking the anti-cheat thresholds in `games-backend/lib/rhythmScoring.js` or in `submit-score`.

Run:

```bash
node scripts/test-anti-cheat.js
```

Requires a games-backend instance reachable at `BACKEND_URL` (defaults to `http://localhost:3005`) and an `INTERNAL_SECRET` available so the protected routes can be exercised.

---

## Related

- Main project README: [../README.md](../README.md)
- Games-backend doc this script targets: [../games-backend/README.md](../games-backend/README.md)
