// ─── MARKOV fairness & exploitability simulation ─────────────────────────────
// Exact port of games-backend/lib/arenaMatch.js decision logic (OpponentModel:
// markov-2 / markov-1 / histogram, 70/30 model/random mix, counter mixing
// 75/15/10 at confidence >= 0.6 else 60/20/20, cold start 45/30/25 P/S/R).
// Simulates best-of-5 matches (9-round cap) against player archetypes to
// answer: is MARKOV fair vs unpredictable play, and does it beat patterns?

const { mulberry32, stats } = require('./lib/rng');

const COUNTER = { 0: 1, 1: 2, 2: 0 };
const MARKOV_PCT = 0.7;
const WINS_NEEDED = 3;

class OpponentModel {
  constructor() { this.hist = [0, 0, 0]; this.m1 = {}; this.m2 = {}; this.moves = []; }
  observe(move) {
    const n = this.moves.length;
    if (n >= 1) { const k = String(this.moves[n - 1]); (this.m1[k] ||= [0, 0, 0])[move]++; }
    if (n >= 2) { const k = `${this.moves[n - 2]},${this.moves[n - 1]}`; (this.m2[k] ||= [0, 0, 0])[move]++; }
    this.hist[move]++; this.moves.push(move);
    if (this.moves.length > 500) this.moves = this.moves.slice(-250);
  }
  predictNext() {
    const n = this.moves.length;
    if (n >= 2) {
      const row = this.m2[`${this.moves[n - 2]},${this.moves[n - 1]}`];
      const t = row ? row[0] + row[1] + row[2] : 0;
      if (t >= 3) { const b = row.indexOf(Math.max(...row)); return { move: b, confidence: row[b] / t }; }
    }
    if (n >= 1) {
      const row = this.m1[String(this.moves[n - 1])];
      const t = row ? row[0] + row[1] + row[2] : 0;
      if (t >= 2) { const b = row.indexOf(Math.max(...row)); return { move: b, confidence: row[b] / t }; }
    }
    const t = this.hist[0] + this.hist[1] + this.hist[2];
    if (t >= 3) { const b = this.hist.indexOf(Math.max(...this.hist)); return { move: b, confidence: this.hist[b] / t }; }
    return null;
  }
  decide(rand) {
    const modeCoin = rand();
    const p = this.predictNext();
    if (modeCoin >= MARKOV_PCT || !p) {
      if (!p) { const r = rand(); return { move: r < 0.45 ? 1 : r < 0.75 ? 2 : 0, mode: 'cold_start' }; }
      return { move: Math.floor(rand() * 3), mode: 'random' };
    }
    const counter = COUNTER[p.move], meta = COUNTER[counter];
    const r = rand();
    const move = p.confidence >= 0.6
      ? (r < 0.75 ? counter : r < 0.9 ? meta : Math.floor(rand() * 3))
      : (r < 0.6 ? counter : r < 0.8 ? meta : Math.floor(rand() * 3));
    return { move, mode: 'markov', predicted: p.move };
  }
}

// ─── player archetypes ────────────────────────────────────────────────────────
// Each returns the player's next move given (rand, history of {playerMove, aiMove, result}).
const ARCHETYPES = {
  // Perfectly unpredictable — the fairness baseline. If MARKOV had any house
  // edge beyond modeling, it would show here.
  uniform_random: (rand) => Math.floor(rand() * 3),

  // Human opening bias (rock-heavy) but otherwise near-random.
  rock_leaner: (rand) => { const r = rand(); return r < 0.41 ? 0 : r < 0.71 ? 1 : 2; },

  // Cycles R→P→S forever — a strong pattern the model should shred.
  cycler: (rand, hist) => hist.length % 3,

  // Win-stay / lose-shift — the most common human RPS heuristic.
  win_stay_lose_shift: (rand, hist) => {
    if (hist.length === 0) return Math.floor(rand() * 3);
    const last = hist[hist.length - 1];
    if (last.result === 'win') return last.playerMove;
    return (last.playerMove + 1) % 3;
  },

  // Copies MARKOV's previous move.
  copycat: (rand, hist) => hist.length === 0 ? Math.floor(rand() * 3) : hist[hist.length - 1].aiMove,

  // Plays the counter of MARKOV's last move — a naive "adaptive" player.
  counter_chaser: (rand, hist) => hist.length === 0 ? Math.floor(rand() * 3) : COUNTER[hist[hist.length - 1].aiMove],
};

function playMatch(model, playerFn, rand) {
  let pw = 0, aw = 0, ties = 0, called = 0;
  const hist = [];
  while (pw < WINS_NEEDED && aw < WINS_NEEDED && hist.length < 9) {
    const playerMove = playerFn(rand, hist);
    const d = model.decide(rand);
    if (d.mode === 'markov' && d.predicted === playerMove) called++;
    model.observe(playerMove);
    let result;
    if (playerMove === d.move) { result = 'tie'; ties++; }
    else if (COUNTER[d.move] === playerMove) { result = 'win'; pw++; }
    else { result = 'loss'; aw++; }
    hist.push({ playerMove, aiMove: d.move, result });
  }
  const outcome = pw > aw ? 'player_won' : aw > pw ? 'ai_won' : 'tie';
  return { outcome, pw, aw, ties, rounds: hist.length, called };
}

// Ladder points — exact port of server.js arenaPoints.
function arenaPoints(m) {
  const won = m.pw > m.aw, tied = m.pw === m.aw;
  let pts = won ? 10 : tied ? 4 : 2;
  if (won && m.aw === 0) pts += 3;
  return pts;
}

function run({ matchesPerArchetype = 20000, seed = 8004 } = {}) {
  const results = {};
  for (const [name, playerFn] of Object.entries(ARCHETYPES)) {
    const rand = mulberry32(seed);
    // One persistent model per archetype: MARKOV learns this player across
    // their whole match history, exactly like the per-wallet model in prod.
    const model = new OpponentModel();
    const outcomes = { player_won: 0, ai_won: 0, tie: 0 };
    let roundWins = 0, roundTotal = 0, calledTotal = 0, ptsTotal = 0;
    const firstK = { player_won: 0, n: 0 }, lastK = { player_won: 0, n: 0 };
    for (let i = 0; i < matchesPerArchetype; i++) {
      const m = playMatch(model, playerFn, rand);
      outcomes[m.outcome]++;
      roundWins += m.pw; roundTotal += m.rounds; calledTotal += m.called;
      ptsTotal += arenaPoints(m);
      if (i < 500) { firstK.n++; if (m.outcome === 'player_won') firstK.player_won++; }
      if (i >= matchesPerArchetype - 500) { lastK.n++; if (m.outcome === 'player_won') lastK.player_won++; }
    }
    const pct = (x, n) => Math.round((x / n) * 1000) / 10;
    results[name] = {
      matches: matchesPerArchetype,
      playerWinPct: pct(outcomes.player_won, matchesPerArchetype),
      aiWinPct: pct(outcomes.ai_won, matchesPerArchetype),
      tiePct: pct(outcomes.tie, matchesPerArchetype),
      roundWinPct: pct(roundWins, roundTotal),
      calledPerMatch: Math.round((calledTotal / matchesPerArchetype) * 100) / 100,
      avgLadderPts: Math.round((ptsTotal / matchesPerArchetype) * 100) / 100,
      first500WinPct: pct(firstK.player_won, firstK.n),
      last500WinPct: pct(lastK.player_won, lastK.n),
    };
  }
  return results;
}

module.exports = { run };
