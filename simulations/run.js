// ─── GameArena Monte Carlo suite ─────────────────────────────────────────────
// Run: node simulations/run.js
// Deterministic (seeded PRNG) — the numbers below reproduce exactly.
// Writes results.json next to this file and prints a summary.

const fs = require('fs');
const path = require('path');
const arena = require('./arena.sim.js');
const skill = require('./skill.sim.js');
const payout = require('./payout.sim.js');

function table(rows, cols) {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (r) => cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ');
  console.log(line(Object.fromEntries(cols.map((c) => [c, c]))));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  rows.forEach((r) => console.log(line(r)));
  console.log('');
}

console.log('\n═══ 1 · MARKOV fairness & exploitability (20,000 bo5 matches per archetype) ═══\n');
const arenaResults = arena.run({});
table(
  Object.entries(arenaResults).map(([archetype, r]) => ({
    archetype,
    'match win %': r.playerWinPct,
    'MARKOV win %': r.aiWinPct,
    'tie %': r.tiePct,
    'round win %': r.roundWinPct,
    'called/match': r.calledPerMatch,
    'pts/match': r.avgLadderPts,
    'first 500 win %': r.first500WinPct,
    'last 500 win %': r.last500WinPct,
  })),
  ['archetype', 'match win %', 'MARKOV win %', 'tie %', 'round win %', 'called/match', 'pts/match', 'first 500 win %', 'last 500 win %'],
);

console.log('═══ 2 · Skill-vs-luck: score distributions by ability tier (10,000 runs each) ═══\n');
const skillResults = skill.run({});
for (const [game, rows] of Object.entries(skillResults)) {
  console.log(`— ${game.toUpperCase()} —`);
  table(
    rows.map((r) => ({ tier: r.tier, mean: r.mean, p10: r.p10, median: r.median, p90: r.p90, ...(r.medianDepth ? { 'median depth': r.medianDepth } : {}) })),
    ['tier', 'mean', 'p10', 'median', 'p90', ...(rows[0].medianDepth !== undefined ? ['median depth'] : [])],
  );
}

console.log('═══ 3 · Weekly pool payouts (500 simulated weeks · 500 G$ pool) ═══\n');
const payoutResults = payout.run({});
for (const [scenario, types] of Object.entries(payoutResults)) {
  console.log(`— ${scenario.replace('_', ' ')} —`);
  table(
    Object.entries(types).map(([type, v]) => ({
      'player type': type,
      players: v.players,
      'avg G$/week': v.avgWeeklyGsPerPlayer,
      'avg pts/week': v.avgWeeklyPointsPerPlayer,
      'podium rate %': v.podiumRatePct,
    })),
    ['player type', 'players', 'avg G$/week', 'avg pts/week', 'podium rate %'],
  );
}

const results = { generatedBy: 'simulations/run.js', arena: arenaResults, skill: skillResults, payout: payoutResults };
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
console.log('results.json written.\n');
