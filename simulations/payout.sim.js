// ─── Weekly pool payout simulation ────────────────────────────────────────────
// Models a week of the MARKOV ladder under different player counts and asks:
//   1. Does the payout structure reward winning over grinding?
//   2. Is the pool farm-proof (loss-spam can't out-earn skilled play)?
//   3. How does expected G$ per player type behave as the arena grows?
//
// Points per match: exact arenaPoints port (win 10, +3 flawless, tie 4, loss 2).
// Match outcomes per skill tier come from the arena simulation's measured
// win rates (see arena.sim.js results). Daily limit: 10 free matches.

const { mulberry32 } = require('./lib/rng');

// Measured match-outcome rates by player type (from arena.sim.js): each entry
// is [P(win), P(tie)] — loss is the remainder. Grinders play max volume with
// weak play; sharks play well; casuals play a little of everything.
const PLAYER_TYPES = {
  shark:   { winP: 0.44, tieP: 0.10, matchesPerDay: [8, 10], share: 0.15 }, // near random-optimal + volume
  regular: { winP: 0.35, tieP: 0.10, matchesPerDay: [3, 7],  share: 0.45 },
  casual:  { winP: 0.30, tieP: 0.10, matchesPerDay: [1, 3],  share: 0.30 },
  grinder: { winP: 0.15, tieP: 0.08, matchesPerDay: [10, 10], share: 0.10 }, // loss-spams max volume
};

// Payout scheme under test: pool splits over top ranks.
// 1st 30% · 2nd 20% · 3rd 12% · 4th-10th share 28% · 11th-20th share 10%.
function payoutShare(rank, players) {
  if (rank === 1) return 0.30;
  if (rank === 2) return 0.20;
  if (rank === 3) return 0.12;
  if (rank <= 10) return 0.28 / 7;
  if (rank <= 20 && players > 20) return 0.10 / 10;
  if (rank <= 20) return 0.10 / 10;
  return 0;
}

function simulateWeek(rand, nPlayers, poolGs) {
  // Build the population
  const players = [];
  for (const [type, cfg] of Object.entries(PLAYER_TYPES)) {
    const count = Math.max(1, Math.round(nPlayers * cfg.share));
    for (let i = 0; i < count; i++) players.push({ type, points: 0, wins: 0, matches: 0 });
  }
  // Simulate 7 days of matches
  for (const p of players) {
    const cfg = PLAYER_TYPES[p.type];
    for (let day = 0; day < 7; day++) {
      const [lo, hi] = cfg.matchesPerDay;
      const n = lo + Math.floor(rand() * (hi - lo + 1));
      for (let m = 0; m < n; m++) {
        const r = rand();
        if (r < cfg.winP) {
          // ~25% of wins are flawless sweeps (matches arena sim observation)
          p.points += rand() < 0.25 ? 13 : 10;
          p.wins++;
        } else if (r < cfg.winP + cfg.tieP) p.points += 4;
        else p.points += 2;
        p.matches++;
      }
    }
  }
  // Rank and pay
  players.sort((a, b) => b.points - a.points || b.wins - a.wins);
  const earnings = {};
  players.forEach((p, i) => {
    const gs = poolGs * payoutShare(i + 1, players.length);
    earnings[p.type] = earnings[p.type] || { players: 0, totalGs: 0, totalPoints: 0, ranks: [] };
    earnings[p.type].players++;
    earnings[p.type].totalGs += gs;
    earnings[p.type].totalPoints += p.points;
    if (i < 3) earnings[p.type].ranks.push(i + 1);
  });
  return earnings;
}

function run({ weeks = 500, poolGs = 500, seed = 7777 } = {}) {
  const scenarios = [10, 25, 50, 200];
  const out = {};
  for (const nPlayers of scenarios) {
    const rand = mulberry32(seed + nPlayers);
    const agg = {};
    for (let w = 0; w < weeks; w++) {
      const e = simulateWeek(rand, nPlayers, poolGs);
      for (const [type, v] of Object.entries(e)) {
        agg[type] = agg[type] || { players: v.players, gs: 0, points: 0, podiums: 0 };
        agg[type].gs += v.totalGs;
        agg[type].points += v.totalPoints;
        agg[type].podiums += v.ranks.length;
      }
    }
    out[`${nPlayers}_players`] = Object.fromEntries(
      Object.entries(agg).map(([type, v]) => [type, {
        players: v.players,
        avgWeeklyGsPerPlayer: Math.round((v.gs / weeks / v.players) * 100) / 100,
        avgWeeklyPointsPerPlayer: Math.round(v.points / weeks / v.players),
        podiumRatePct: Math.round((v.podiums / (weeks * 3)) * 1000) / 10,
      }]),
    );
  }
  return out;
}

module.exports = { run };
