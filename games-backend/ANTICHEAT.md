# Anti-cheat: what is actually enforced, and what isn't

Written 2026-07-17 after auditing the score path end to end. Read this before
changing `/api/sign-score` or "fixing" a score bound. It exists because the
obvious fixes here are wrong in ways that hurt real players.

## The current state, honestly

| Game | Score signed is… | Client trusted? |
|---|---|---|
| **Rhythm** | **server-computed** from a replayed tap log | **No** ✅ |
| **Simon** | the client's claimed number | **Yes** ❌ |
| **Stack** | the client's claimed number | **Yes** ❌ |

Rhythm is the reference implementation: `rhythmPhysicsCheck` → `rhythmComputeScore`
→ `rhythmJitterCheck`, and the **computed** score is what gets signed. The
client's `score` field is ignored entirely.

Simon and Stack fall through to the `else` branch and we sign whatever the
browser sent. That is the real remaining hole. The weekly leaderboard pays G$,
so it is worth money to exploit.

## Two traps. Both look like fixes. Both are wrong.

### Trap 1: lowering the score ceiling

Do not "tighten" the 1,000,000 bound to something closer to real scores.

The client clamps before submitting:

```js
// frontend/app/games/stack/page.tsx (and rhythm, simon)
const scoreToSubmit = Math.min(1_000_000, Math.max(0, Math.round(score)));
```

and `rhythmScoring.js` has **no internal cap** ("the finite chart + the encore's
accelerating speed wall bound it"). So a genuinely great Rhythm run lands on
**exactly 1,000,000**. Three accounts sit there right now
(cornensecornelia · 228 plays, NIAR21 · 65, Ackerman). Read naively that looks
like everyone submitting the maximum. **It is a clamp artifact, not fraud.**

A ceiling cannot distinguish a cheat from a great run. It only fires the day
someone plays out of their skin. Do not add one.

(Separately: that clamp means top players **tie at exactly 1,000,000** and the
board cannot rank them against each other. Worth raising or removing, since
Rhythm's score is server-computed now anyway.)

### Trap 2: "just replay Stack from the tap timestamps"

This is the one that looks obviously right and silently robs people.

Stack's block is a **client-side animation** driven by a clamped delta:

```js
// frontend/app/games/stack/page.tsx
const dt = Math.min(0.05, (wall - lastWall) / 1000);   // clamped at 50ms
```

Block position is `Σ(speed × dtᵢ)` over the frames **that device actually
rendered**, not a function of wall-clock time. On a phone that drops frames,
`dt` clamps and the block travels **less** than elapsed time implies. A server
replaying from timestamps computes a position the player never saw.

`PERFECT_TOL` is **7 px**. A few pixels of drift turns a perfect drop into a
slice. So timestamp replay would quietly change or reject honest scores,
**worst on the cheap Android hardware most of our players use**. That is a worse
bug than the hole it closes, because it is invisible and it punishes the
innocent.

Also note `START_W_FRAC = 0.62` — the starting width scales to the player's
**viewport**, so the run is not even reproducible without the client's screen
size.

## What is actually achievable (and what "server-authoritative" can mean here)

Rhythm can be truly verified because the **chart is fixed and known server-side**:
notes exist at known times, so taps can be checked against ground truth, and
inhuman precision is detectable (`rhythmJitterCheck`).

Stack has **no such ground truth**. The block's position is whatever the
client's animation says it was. The server cannot independently know it without
owning the clock — and owning the clock means round-tripping every tap, which
is unplayable for a precision game.

So for Simon and Stack the honest goal is not "cryptographically correct score".
It is **raise the cost of cheating from trivial to hard**:

1. **Recompute the score from an input log.** The client sends the run's inputs
   (drops: their position/offset/level, or Simon: the taps + the seeded
   pattern). The server derives the score from the log and signs **that**. This
   kills the current attack outright: you can no longer just type a number, you
   must forge a self-consistent run.
2. **Check the log is human.** A forged log with a perfect drop every time is
   statistically impossible for a person. Port the Rhythm idea: variance /
   jitter / reaction-time distribution. This is what actually catches the bot,
   not the score bound.
3. **Simon additionally needs a server seed.** Its pattern is currently
   `Math.random()` on the client, so there is nothing to check the taps against.
   `/api/start-game` should issue the seed and the client should derive the
   pattern from it — then the taps become verifiable.

Step 1 is the big win. Step 2 is what makes step 1 hold.

## How to ship it without hurting anyone

Physics parity is subtle (see Trap 2). Never flip enforcement on day one.

1. **Shadow mode.** Compute the server score, log `serverScore vs clientScore`,
   and keep signing the **client's** score. Zero player impact.
2. **Verify against real runs.** Deltas should be ~0 for honest players. If they
   are not, the port is wrong — fix it while nobody is affected.
3. **Enforce.** Sign the computed score, ignore the client.
4. Repeat per game. Stack first (already deterministic, no gameplay change),
   Simon second (needs the seed change).

## Do not

- Do not add a per-game score ceiling. (Trap 1.)
- Do not replay Stack from wall-clock timestamps. (Trap 2.)
- Do not enforce a new replay without shadowing it first.
- Do not read `/api/submit-score`'s speed-hack block as protection: it is
  unreachable (`requireSecret` makes `isInternalCall` always true), and has
  never run.
