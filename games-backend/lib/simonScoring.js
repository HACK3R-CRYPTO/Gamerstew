// ─── simonScoring.js ─────────────────────────────────────────────────────────
// Server-side replica of Simon Memory's pattern generation + scoring. Used by
// /api/sign-score in SHADOW MODE only: the computed score is logged next to the
// client's claimed score, but the CLIENT'S score is still what gets signed.
// Read ANTICHEAT.md before touching this or wiring it into enforcement.
//
// WHY this exists, and WHY it looks the way it does:
//
// ANTICHEAT.md says Simon has a second problem the other games don't: its
// pattern was pure Math.random() on the client, so the server had NO ground
// truth to check the taps against ("Simon additionally needs a server seed").
// The fix has two halves:
//
//   1. SEED THE PATTERN. The client now derives the sequence from a keccak PRNG
//      seeded off the session token (mirror of lib/arenaMatch.js makeRand). The
//      server derives the SAME sequence from the SAME token, so it knows exactly
//      which color the player was supposed to tap at every step. derivePattern()
//      below is that server half — it MUST stay byte-for-byte identical to the
//      client helper in frontend/app/games/simon/page.tsx or the shadow deltas
//      drift (and, once enforced, honest players get rejected).
//
//   2. RECOMPUTE THE SCORE FROM THE TAP LOG. With a known pattern the taps are
//      finally verifiable: computeSimonScore() checks the player's taps against
//      the derived pattern prefix-for-prefix and rebuilds the score from the
//      count of FULL rounds correctly tapped. This kills "type any number" —
//      a forged score now needs a self-consistent tap log that matches a
//      pattern the attacker can't predict without the token.
//
// SHADOW-FIRST (ANTICHEAT.md "How to ship it without hurting anyone"): today we
// only LOG serverScore vs clientScore. We do NOT sign the computed score. An
// imperfect port must never affect a player; deltas should be ~0 for honest
// runs, and any drift gets fixed while nobody is impacted.

const { ethers } = require('ethers');

// ─── Color-id ordering · MUST mirror frontend/app/games/simon/page.tsx ───────
// BASE_COLORS (4) are the round 1-5 palette; BONUS_COLOR (purple) is unlocked
// once the player CLEARS round 5, growing the palette to 5. The client draws
// pattern element i from 4 colors while i < 5 and from 5 colors once i >= 5
// (the boundary matches the client's colorsRef flip at newSeqs === 5). The id
// ordering here is exactly BASE_COLORS' ids then BONUS_COLOR's id.
const BASE_IDS = ['red', 'cyan', 'yellow', 'green'];
const BONUS_ID = 'purple';
const ALL_IDS = [...BASE_IDS, BONUS_ID];

// Round at which the 5th color joins the palette (== BONUS_UNLOCK_ROUND client-side).
const BONUS_UNLOCK_INDEX = 5;

// ─── Seeded PRNG (mirror of arenaMatch.js makeRand, index-addressed) ─────────
// seed = keccak256(utf8(token)). For pattern element i we hash utf8(`${seed}|${i}`)
// and take the first 4 bytes as a [0,1) float — the exact same arithmetic the
// arena engine uses (parseInt(h.slice(2,10),16) / 0x100000000). Index-addressed
// (not a running counter) because the client generates the pattern one element
// at a time via addNext, appending element i when the current length is i; a
// pure function of (seed, i) reproduces that regardless of call order.
function seedFromToken(token) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(token)));
}

// Deterministic draw for pattern element i. i < 5 → 4 colors, i >= 5 → 5 colors.
function drawColorId(seedHex, i) {
  const useBonus = i >= BONUS_UNLOCK_INDEX;
  const ids = useBonus ? ALL_IDS : BASE_IDS;
  const h = ethers.keccak256(ethers.toUtf8Bytes(`${seedHex}|${i}`));
  const r = parseInt(h.slice(2, 10), 16) / 0x100000000; // first 4 bytes → [0,1)
  return ids[Math.floor(r * ids.length)];
}

// ─── derivePattern · PURE function ───────────────────────────────────────────
// Reproduce the exact sequence the seeded client generated for this session.
// Returns [] for a missing token or non-positive length (guests / unminted
// players have no token and use Math.random on the client — nothing to derive,
// and we MUST NOT crash on the absence).
function derivePattern(sessionToken, length) {
  if (!sessionToken || !Number.isInteger(length) || length <= 0) return [];
  const seedHex = seedFromToken(sessionToken);
  const out = [];
  for (let i = 0; i < length; i++) out.push(drawColorId(seedHex, i));
  return out;
}

// ─── computeSimonScore · PURE function ───────────────────────────────────────
// Input: { sessionToken, tapLog, clientElapsedMs }
//   · sessionToken  : the game_sessions token · seeds the expected pattern
//   · tapLog        : ordered array of color ids the player tapped across the
//                     WHOLE run. Simon replays from the start every round, so a
//                     run that cleared R rounds emits chunks of length 1,2,...,R:
//                       round 1 → [p0]
//                       round 2 → [p0,p1]
//                       round 3 → [p0,p1,p2]  ...
//                     Total taps to fully clear R rounds = R(R+1)/2. The losing
//                     tap (and its partial final round) trails the last full
//                     round and is NOT counted as verified.
//   · clientElapsedMs : total run time · feeds the speed bonus only (see below)
//
// Output: { score, roundsVerified, roundsClaimed, tapsOk }
//   · roundsClaimed  : how many COMPLETE round-chunks the tap log contains,
//                      correct or not (largest R with R(R+1)/2 <= tapLog.length)
//   · roundsVerified : how many of those chunks matched the derived pattern
//                      prefix exactly, counting from round 1 up to the first
//                      mismatch (a run ends on the first wrong tap, so a real
//                      log is correct-prefix then done)
//   · tapsOk         : true if every complete chunk verified (roundsVerified
//                      === roundsClaimed) · false the moment a chunk mismatches
//   · score          : roundsVerified * 12 + speedBonus, reproducing the client
//                      formula newSeqs*10 + speedBonus + newSeqs*2 (== newSeqs*12
//                      + speedBonus) from page.tsx. speedBonus =
//                      max(0, floor((60000 - clientElapsedMs)/1000)).
//
// NOTE on the speed bonus: the client computes it per-round from the elapsed at
// each clear, so the final score uses the LAST cleared round's elapsed. We only
// have the run's total elapsed here, so this is a close SHADOW approximation of
// that term — fine because we never sign this number, we only log the delta.
function computeSimonScore({ sessionToken, tapLog, clientElapsedMs }) {
  const taps = Array.isArray(tapLog) ? tapLog : [];

  // How many complete round-chunks does the log hold? (independent of correctness)
  let roundsClaimed = 0;
  {
    let need = 0;
    let r = 1;
    while (need + r <= taps.length) {
      need += r;
      roundsClaimed++;
      r++;
    }
  }

  // Derive a pattern long enough to cover the deepest round attempted. Round R
  // needs pattern indices 0..R-1, so length == roundsClaimed suffices; taps.length
  // is an always-safe over-derive when the log is short.
  const pattern = derivePattern(sessionToken, Math.max(roundsClaimed, 1));

  // Walk the tap log in round-chunks. Round `round` consumes `round` taps, which
  // must equal pattern[0..round-1]. Count fully-correct rounds; stop on the first
  // mismatch (a real Simon run cannot continue past a wrong tap).
  let roundsVerified = 0;
  let tapsOk = true;
  let idx = 0;
  let round = 1;
  while (idx + round <= taps.length) {
    let ok = true;
    for (let j = 0; j < round; j++) {
      if (taps[idx + j] !== pattern[j]) { ok = false; break; }
    }
    if (!ok) { tapsOk = false; break; }
    roundsVerified++;
    idx += round;
    round++;
  }

  const elapsed = Number.isFinite(clientElapsedMs) ? clientElapsedMs : 0;
  const speedBonus = Math.max(0, Math.floor((60000 - elapsed) / 1000));
  const score = roundsVerified * 12 + speedBonus;

  return { score, roundsVerified, roundsClaimed, tapsOk };
}

module.exports = {
  BASE_IDS,
  BONUS_ID,
  ALL_IDS,
  derivePattern,
  computeSimonScore,
};
