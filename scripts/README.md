# scripts

Utility scripts that don't belong inside a per-service folder. Run from the repo root.

## Contents

- **`test-anti-cheat.js`** · exercises the games-backend score-signing path against every known attack. It runs nine attacks in sequence · direct `/api/sign-score` with no session, a fake session token, a real session with missing / empty tap logs, submissions under the minimum duration, sub-30ms tap gaps, synthetic perfect timing, session-token replay, and a full proof-of-concept chain that claims score `999999` with realistic jittered taps. Each attack is expected to be rejected (or, for the final one, silently corrected to the server-computed score). If the run ends with `ALL ATTACKS BLOCKED`, the anti-cheat patch is working as designed.

The script targets the deployed backend hardcoded at the top of the file (`https://game-backend-production-6130.up.railway.app`). Attacks 7-9 also `require('../games-backend/lib/rhythmScoring')` to rebuild the exact server chart, so run it from a checkout that has `games-backend/` present.

Run:

```bash
INTERNAL_SECRET=<railway-secret> WALLET=0x... node scripts/test-anti-cheat.js
```

- `INTERNAL_SECRET` · the games-backend internal secret (Railway Variables tab). Sent as the `x-internal-secret` header so the protected routes accept the calls.
- `WALLET` · a test wallet address you've used to play.

Both are required · the script exits immediately if either is missing.

---

## Related

- Main project README: [../README.md](../README.md)
- Games-backend doc this script targets: [../games-backend/README.md](../games-backend/README.md)
