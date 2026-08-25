# GoodDollar Engagement Rewards — integration contract

**Status:** Applied to the allocation. NOT yet integrated on-chain (no claim flow shipped).
**Purpose:** This is the source of truth for the integration. The values here are what
we committed to the GoodDollar team (Lewis) in the admin. **Do not ship an integration
that exceeds or contradicts anything below without re-confirming with GoodDollar first.**

Last updated: 2026-08-25

---

## The split (committed)

| Recipient | Share | Notes |
|---|---|---|
| GameArena (dApp) | **70%** | Funds prize pools + operations, which flow back to players |
| Player (user) | **15%** | The verified human who did the action |
| Inviter (referrer) | **15%** | The friend who referred that player |

- Configured on the EngagementRewards app registration as: User+Inviter = 30, User = 50.
- **Do not raise the dApp share above 70%** — 70/30 is what we told GoodDollar. Going higher
  reads as extractive and was explicitly the number we defended.

### Addresses (registered on the application)
- **App / signer:** `0xc1cFA63135eA2fB5AB795cF10e4c79F4DD03c3f6` (backend signer)
- **Reward receiver:** `0x86BCed809d1c909A991E36978b4Ca8DD586205B0` (ARENA_POOL_WALLET)
  <!-- confirm before integrating; treasury 0xa479...894d is the alternative if we move it -->

---

## The engagement loop (committed to GoodDollar)

```
Sign up → Verify (GoodDollar) → Play 3 games in a day → eligible → Claim daily reward → repeat next day
```

**Eligibility rule a user must meet before a reward is claimable:**
1. **Verified** — GoodDollar face verification (`isWhitelisted` = true). Hard gate; unverified
   wallets earn nothing. Already enforced everywhere in GameArena today.
2. **3 games in a day** — a real active session (~2–3 min), not a single tap. This is the
   qualifying action per period.

**Cadence:** claimable **once per day** (daily cooldown). This is the value we gave GoodDollar
— the daily rhythm is what drives retention. Do not make it claimable more often than once/day
without re-confirming.

**Inviter:** earns their 15% automatically each day their referred, verified player hits the
3-game threshold. Inviter is resolved from our existing referral data (`season_v1_referrer_intent`).

> If the game-count threshold or the daily cadence changes, it MUST be re-communicated to
> GoodDollar. These are commitments, not internal knobs.

---

## What GameArena gets out of the loop (the reason it's real, not farmed)

- **Retention:** users must return and play each day to stay eligible → daily active use.
- **Acquisition:** the inviter share turns players into a referral engine for verified humans.
- **Sustainability:** the 70% dApp share funds Cups + the community pool, so the economy
  self-sustains instead of needing external top-ups.
- **For GoodDollar:** more verified humans transacting G$ on Celo every day, with a real reason
  to keep their verification current.

---

## Integration checklist (when we build it)

- [ ] Gate the claim on `isVerified(wallet)` (`isWhitelisted` on the GoodDollar identity contract)
- [ ] Count qualifying activity: 3 completed games in the current UTC day (from on-chain plays)
- [ ] Enforce the once-per-day cooldown per wallet (contract-side and/or backend)
- [ ] Resolve the inviter from `season_v1_referrer_intent` and pass it into the claim
- [ ] Call the EngagementRewards contract's app-claim with the user signature + inviter
- [ ] Distribute per the 70 / 15 / 15 split configured on registration
- [ ] Never let the flow reward an unverified wallet, ever
- [ ] Open the PR and share it with GoodDollar (Lewis asked for the commit/PR)

---

## Guardrails (do not exceed what was told to admin)

1. dApp share ≤ 70%.
2. Claim cadence no more frequent than once per day.
3. Verification gate is non-negotiable — no reward without `isWhitelisted`.
4. Any change to the threshold (3 games) or cadence (daily) requires re-confirming with GoodDollar
   before shipping.
