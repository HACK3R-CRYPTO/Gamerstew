// ─── stackScoring.js ─────────────────────────────────────────────────────────
// Server-side replica of Stack Tower's per-drop scoring. Used by
// /api/sign-score in SHADOW MODE only: the computed score is logged next to the
// client's claimed score, but the CLIENT'S score is still what gets signed.
// Read ANTICHEAT.md before touching this or wiring it into enforcement.
//
// WHY this exists, and WHY it looks the way it does:
//
// ANTICHEAT.md "Trap 2" says: do NOT replay Stack from wall-clock timestamps.
// Block position on the client is Sigma(speed * dt) over the frames that device
// actually rendered, with dt clamped at 50ms. A phone that drops frames moves
// the block LESS than elapsed time implies, and PERFECT_TOL is only 7px, so a
// timestamp replay would silently turn honest perfects into slices on exactly
// the cheap Android hardware most players use. That is a worse bug than the
// hole it closes.
//
// So this function does NOT touch timestamps and does NOT re-simulate the
// animation. It replays only the DISCRETE DROP EVENTS the client already
// computed per drop (landed / perfect / offset), and reproduces the client's
// scoring arithmetic (frontend/app/games/stack/page.tsx drop()) EXACTLY. The
// per-drop offset/perfect flag is the ground truth the client committed to at
// tap time; re-deriving points from it is deterministic and device-independent.
//
// This is Step 1 of ANTICHEAT.md's rollout ("recompute the score from an input
// log"). Step 2 (humanness check on the drop log) and enforcement come later.
// Any coarse timestamps in the log are for that FUTURE humanness check ONLY and
// MUST NOT feed the score. This file never reads them.

// ─── Constants · MUST mirror frontend/app/games/stack/page.tsx ───────────────
// If the client changes PERFECT_TOL or the points formula, update this file too
// or the shadow deltas will drift and (once enforced) real players get rejected.
const PERFECT_TOL = 7;              // px · offset <= 7 counts as a perfect drop
const PERFECT_COMBO_CLAMP = 8;      // points = 2 + min(combo, 8)
const NORMAL_POINTS = 1;            // flat +1 on a sliced (non-perfect) landing
const SCORE_SUBMIT_MIN = 0;
const SCORE_SUBMIT_MAX = 1_000_000; // do NOT lower · genuine runs hit this (Trap 1)

// ─── computeStackScore · PURE function ───────────────────────────────────────
// Input: dropLog — an ordered array of per-drop events the client emitted.
//   Each entry (fields per the spec / ANTICHEAT.md Step 1):
//     · dropIndex : 0-based order of the drop (informational)
//     · level     : levelRef BEFORE the drop (base = 1) (informational)
//     · landed    : bool · overlap > 0 (false = complete miss, run-ending)
//     · perfect   : bool · landed && offset <= PERFECT_TOL
//     · offset    : px · abs(m.x - below.x), only meaningful when landed
//     · t         : coarse timestamp · FUTURE humanness check ONLY · IGNORED here
//
// Output: { score, drops, perfects, maxCombo }
//   · score    : round(scoreRef) clamped to [0, 1_000_000] · mirrors page.tsx:571
//   · drops    : count of landed drops scored
//   · perfects : count of perfect drops
//   · maxCombo : longest perfect streak seen
//
// Mirrors drop() exactly:
//   CASE A · a complete miss (landed === false, i.e. overlap <= 0): the block
//     falls as a shard. It contributes 0 points and does NOT touch combo. We do
//     NOT terminate the loop on a miss: with the Save-Your-Run (M1) perk a
//     signed-in, minted player can buy a save and resume after a miss, so the
//     drop log can legitimately hold a landed:false entry mid-array followed by
//     more landed:true drops the client scored. We skip the miss and keep going.
//     For a normal (unsaved) run the terminal miss is the last entry, so
//     skipping it and letting the loop end yields the same total anyway.
//   CASE B · landed:
//     · PERFECT (offset <= 7): comboRef += 1 FIRST, then points = 2 + min(c, 8)
//       (so combo 1 -> +3 ... combo 8 -> +10, and combo >= 8 stays +10, capped).
//     · NORMAL  (offset  > 7): comboRef reset to 0, scoreRef += 1 (flat).
// No time/width/level multiplier is ever applied to the score. Width only
// affected future overlap on the client, which the per-drop `landed`/`offset`
// fields already encode, so we never need it here.
function computeStackScore(dropLog) {
  let score = 0;
  let combo = 0;      // comboRef · starts 0 at game start (page.tsx:470)
  let drops = 0;
  let perfects = 0;
  let maxCombo = 0;

  if (!Array.isArray(dropLog)) {
    return { score: 0, drops: 0, perfects: 0, maxCombo: 0 };
  }

  for (const d of dropLog) {
    // CASE A · complete miss. Contributes 0 and does NOT touch combo, then we
    // skip to the next entry (the client can resume after a bought save, so a
    // miss is not terminal). Guard against a truthy-but-wrong shape by treating
    // anything not explicitly landed as a miss.
    if (!d || d.landed !== true) continue;

    if (d.perfect === true) {
      // PERFECT · combo increments BEFORE points, and the new value is used.
      combo += 1;
      const points = 2 + Math.min(combo, PERFECT_COMBO_CLAMP);
      score += points;
      perfects += 1;
      if (combo > maxCombo) maxCombo = combo;
    } else {
      // NORMAL slice · combo resets, flat +1.
      combo = 0;
      score += NORMAL_POINTS;
    }
    drops += 1;
  }

  // Final clamp · mirrors scoreToSubmit on the client (page.tsx:571). Do NOT
  // lower the ceiling (ANTICHEAT.md Trap 1) · genuine tall towers can reach it.
  const clamped = Math.min(SCORE_SUBMIT_MAX, Math.max(SCORE_SUBMIT_MIN, Math.round(score)));
  return { score: clamped, drops, perfects, maxCombo };
}

module.exports = {
  PERFECT_TOL,
  PERFECT_COMBO_CLAMP,
  NORMAL_POINTS,
  computeStackScore,
};
