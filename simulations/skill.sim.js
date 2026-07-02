// ─── Skill-vs-luck simulations for the three skill games ─────────────────────
// Models players as timing/recall/aim accuracy tiers and pushes them through
// the EXACT scoring formulas from the codebase. The claim under test: scores
// are monotonic in skill with clean separation between tiers — i.e. the
// leaderboards measure ability, not luck.

const { mulberry32, makeGaussian, stats } = require('./lib/rng');

// ═══ RHYTHM RUSH ══════════════════════════════════════════════════════════════
// Formulas from games-backend/lib/rhythmScoring.js:
//   PERFECT_WINDOW=0.08s, GOOD_WINDOW=0.28s, 32-note main chart over 45s.
//   hit: base = perfect?10:5 · precisionBonus = round(max(0,1-diff/0.28)*8)
//   multiplier = 1 + floor(combo/5) · miss resets combo · cap 1,000,000.
// Player model: tap error ~ N(0, sigma). |error| > GOOD_WINDOW = miss.
const RHYTHM_NOTES = 32;
function rhythmRun(gauss, sigmaSec) {
  let score = 0, combo = 0;
  for (let i = 0; i < RHYTHM_NOTES; i++) {
    const diff = Math.abs(gauss(0, sigmaSec));
    if (diff > 0.28) { combo = 0; continue; }
    const base = diff <= 0.08 ? 10 : 5;
    const precisionBonus = Math.round(Math.max(0, 1 - diff / 0.28) * 8);
    const multiplier = 1 + Math.floor(combo / 5);
    score += (base + precisionBonus) * multiplier;
    combo++;
  }
  return Math.min(score, 1_000_000);
}

// ═══ SIMON MEMORY ═════════════════════════════════════════════════════════════
// Formula from frontend/app/games/simon/page.tsx:
//   score = rounds*10 + rounds*2 + speedBonus, speedBonus = max(0, floor((60000-elapsed)/1000))
// Player model: per-element recall probability p. Round survives with p^len.
// Elapsed time model: each round shows len elements (flash+delay, decaying
// 1200ms → 550ms floor) then the player replays (~600ms/element).
function simonRun(rand, recallP) {
  let rounds = 0, elapsedMs = 0;
  for (let len = 1; len <= 60; len++) {
    const showPer = Math.max(550, 1200 - len * 40);
    elapsedMs += len * showPer + len * 600;
    if (elapsedMs > 10 * 60 * 1000) break;              // 10-minute hard cap
    let ok = true;
    for (let e = 0; e < len; e++) if (rand() > recallP) { ok = false; break; }
    if (!ok) break;
    rounds++;
  }
  const speedBonus = Math.max(0, Math.floor((60000 - elapsedMs) / 1000));
  return { score: rounds * 12 + speedBonus, rounds };
}

// ═══ STACK TOWER ══════════════════════════════════════════════════════════════
// Formulas from frontend/app/games/stack/page.tsx:
//   PERFECT_TOL=7px · perfect: 2+min(combo,8) pts · slice: +1 pt, width -=|offset|
//   speed = 2.4 + level*0.12 + min(level²*0.002, 2)
// Player model: drop offset ~ N(0, sigmaPx * speed/2.4) — aim degrades as the
// block moves faster. Run ends when |offset| >= current width. Start width 200px.
function stackRun(gauss, sigmaPx) {
  let width = 200, score = 0, combo = 0;
  for (let level = 1; level <= 500; level++) {
    const speed = 2.4 + level * 0.12 + Math.min(level * level * 0.002, 2);
    const offset = Math.abs(gauss(0, sigmaPx * (speed / 2.4)));
    if (offset >= width) break;                          // complete miss → end
    if (offset <= 7) { combo++; score += 2 + Math.min(combo, 8); }
    else { combo = 0; score += 1; width -= offset; if (width < 4) break; }
  }
  return score;
}

const TIERS = {
  rhythm: [
    { name: 'expert (σ=35ms)', sigma: 0.035 },
    { name: 'skilled (σ=70ms)', sigma: 0.070 },
    { name: 'casual (σ=120ms)', sigma: 0.120 },
    { name: 'novice (σ=200ms)', sigma: 0.200 },
    { name: 'masher (σ=350ms)', sigma: 0.350 },
  ],
  simon: [
    { name: 'expert (p=0.99)', p: 0.99 },
    { name: 'skilled (p=0.97)', p: 0.97 },
    { name: 'casual (p=0.93)', p: 0.93 },
    { name: 'novice (p=0.85)', p: 0.85 },
  ],
  stack: [
    { name: 'expert (σ=6px)', sigma: 6 },
    { name: 'skilled (σ=12px)', sigma: 12 },
    { name: 'casual (σ=22px)', sigma: 22 },
    { name: 'novice (σ=40px)', sigma: 40 },
  ],
};

function run({ runsPerTier = 10000, seed = 42220 } = {}) {
  const out = { rhythm: [], simon: [], stack: [] };

  for (const tier of TIERS.rhythm) {
    const gauss = makeGaussian(mulberry32(seed));
    const scores = Array.from({ length: runsPerTier }, () => rhythmRun(gauss, tier.sigma));
    out.rhythm.push({ tier: tier.name, ...stats(scores) });
  }
  for (const tier of TIERS.simon) {
    const rand = mulberry32(seed + 1);
    const scores = [], depths = [];
    for (let i = 0; i < runsPerTier; i++) { const r = simonRun(rand, tier.p); scores.push(r.score); depths.push(r.rounds); }
    out.simon.push({ tier: tier.name, ...stats(scores), medianDepth: stats(depths).median });
  }
  for (const tier of TIERS.stack) {
    const gauss = makeGaussian(mulberry32(seed + 2));
    const scores = Array.from({ length: runsPerTier }, () => stackRun(gauss, tier.sigma));
    out.stack.push({ tier: tier.name, ...stats(scores) });
  }
  return out;
}

module.exports = { run };
