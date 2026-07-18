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

    // Derive "perfect" from the OFFSET, never from the client's `perfect` flag.
    // The client sets perfect = offset <= PERFECT_TOL (page.tsx), so for an
    // honest run this is identical (parity is unaffected · proven over 250k
    // runs). But for the future ENFORCE step it matters: a forged log could set
    // perfect:true on every entry, while offset is the value that maps to what
    // the animation actually showed. Ground truth is the number, not the flag.
    const isPerfect = typeof d.offset === 'number' && d.offset <= PERFECT_TOL;

    if (isPerfect) {
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

// ─── Humanness check (ANTICHEAT.md Step 2) ───────────────────────────────────
// Recomputing the score from the drop log stops "submit any number", but not
// "submit a forged perfect log". This is the guard against the forged log. It
// looks for signatures no human run can produce:
//
//   1. RATE · drops per second, from the log's own timestamps. The block has to
//      travel and the player has to react, so sustained ultra-fast drops are
//      impossible. A forged log dumping tens of thousands of drops into an
//      11-minute session (the sign-score session cap) shows up here immediately.
//   2. OFFSET UNIFORMITY · a real player is never pixel-identical every drop.
//      Many landed drops with (almost) no spread in offset is a generated log,
//      not a hand.
//
// SHADOW-FIRST: thresholds are deliberately loose so we never flag a real player
// on day one. The point today is to LOG the signal (`human`, `reasons`, stats)
// alongside the score delta, tune from real distributions, and only then wire it
// into the ENFORCE step. Returns { human, reasons, stats } · `human:false` is a
// FLAG for review, not (yet) a rejection.
const HUMAN_MAX_DROPS_PER_SEC = 12;   // generous · real fast play is ~1-3/s
const UNIFORM_MIN_DROPS = 40;         // only judge uniformity with enough samples
const UNIFORM_MIN_DISTINCT = 3;       // fewer distinct offsets than this = suspect

function computeStackHumanness(dropLog) {
  const reasons = [];
  if (!Array.isArray(dropLog) || dropLog.length === 0) {
    return { human: true, reasons: [], stats: { landed: 0 } };
  }
  const landed = dropLog.filter(d => d && d.landed === true);
  const ts = dropLog.map(d => (d && typeof d.t === 'number' ? d.t : null)).filter(t => t !== null);

  // 1) Rate
  let dropsPerSec = 0;
  if (ts.length >= 2) {
    const spanSec = Math.max(0.001, (ts[ts.length - 1] - ts[0]) / 1000);
    dropsPerSec = dropLog.length / spanSec;
    if (dropsPerSec > HUMAN_MAX_DROPS_PER_SEC) {
      reasons.push(`rate ${dropsPerSec.toFixed(1)}/s > ${HUMAN_MAX_DROPS_PER_SEC}/s`);
    }
  }

  // 2) Offset uniformity (only on landed drops, with enough samples)
  let distinctOffsets = 0;
  if (landed.length >= UNIFORM_MIN_DROPS) {
    distinctOffsets = new Set(landed.map(d => Math.round(d.offset ?? -1))).size;
    if (distinctOffsets < UNIFORM_MIN_DISTINCT) {
      reasons.push(`offset uniformity · ${distinctOffsets} distinct across ${landed.length} drops`);
    }
  }

  return {
    human: reasons.length === 0,
    reasons,
    stats: {
      landed: landed.length,
      total: dropLog.length,
      dropsPerSec: Math.round(dropsPerSec * 10) / 10,
      distinctOffsets,
    },
  };
}

module.exports = {
  PERFECT_TOL,
  PERFECT_COMBO_CLAMP,
  NORMAL_POINTS,
  computeStackScore,
  computeStackHumanness,
};
