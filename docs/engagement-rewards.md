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

## The engagement loop (corrected per GoodDollar — Lewis, Aug 2026)

**Constraint:** the GoodDollar engagement reward can be claimed **once per ~180 days per user**
(tied to the identity/authentication period). So it is NOT a recurring daily payout — it is a
**one-time activation reward** per user per period. The earlier "claim daily → repeat" design was
wrong and has been removed.

```
New user → Verify (GoodDollar) → complete first real engagement → engagement reward claimed ONCE
                                                                    (for the user AND their inviter)
```

**Eligibility (one-time activation) — deliberately NOT instant, to stop farming:**
1. **Verified** — GoodDollar face verification (`getWhitelistedRoot` non-zero). Hard sybil gate.
2. **Engaged across time, not a single session** — the user must play on **at least 2 separate
   days** (a minimum ~48h window between first play and unlock). A freshly-verified wallet cannot
   verify and claim the same day. This is the anti-farming time-out GoodDollar asked for.
3. **Real volume** — a minimum number of completed games (e.g. 5+), not one tap.

Only when all three hold does GameArena trigger the engagement claim **once** for that user, plus
the inviter's share. It is an **acquisition + activation** reward for turning a verified human into
a genuinely engaged, returning player — which is inherently a once-per-user event.

**Why this resists farmers (the GoodDollar concern):** face-verification blocks sybils up front,
and the multi-day + volume requirement means a reward can't be grabbed instantly on a fresh
wallet — the user has to actually come back and play before anything unlocks. The reward tracks
*engagement over time*, not a one-tap claim.

**Ongoing engagement is NOT this reward.** Retention and repeat play are driven by GameArena's
OWN economy — Arena Cups, the community pool, loyalty payouts, prize rooms. Those recur; the
GoodDollar engagement reward does not, and the design has no dependency on re-claiming within
the 180-day window.

**Inviter:** earns their 15% share at the same one-time activation moment (when their referred,
verified friend activates). Resolved from `season_v1_referrer_intent`.

> Cadence is a GoodDollar constraint (once / ~180 days / user), not our knob. Do not build any
> flow that assumes more frequent claims.

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
2. The engagement reward is claimable **once per ~180 days per user** — it is a one-time activation
   reward, NOT recurring. Never build a flow that assumes daily/repeat claims.
3. Verification gate is non-negotiable — no reward without a non-zero `getWhitelistedRoot`.
4. Ongoing engagement/retention is funded by GameArena's own economy (Cups, community pool, prize
   rooms), which is entirely separate from the GoodDollar engagement reward.
5. Any change to the activation threshold (first N games) requires re-confirming with GoodDollar.
