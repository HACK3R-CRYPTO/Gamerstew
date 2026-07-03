// ─── Arena Instant Match Engine ──────────────────────────────────────────────
// MARKOV's brain, served over HTTP. Port of the on-chain agent's OpponentModel
// + hash-committed RNG (agent/src/ArenaAgent.ts) into an instant best-of-5
// match loop. No wagers, no chain in the loop — the chain is the receipt
// layer (Oracle attests completed matches asynchronously).
//
// Fairness: commit-reveal. At match start we generate a 32-byte seed and
// return keccak256(seed) to the client BEFORE any round is played. Every
// MARKOV decision draws from a PRNG derived only from (seed, matchId,
// counter), and the strategy is a published deterministic function of the
// seed + the player's observed move history. At match end the seed is
// revealed, so anyone can replay the match and verify every AI move.

const { ethers } = require('ethers');
const crypto = require('crypto');

// RPS moves: 0 = rock, 1 = paper, 2 = scissors
const MOVES = ['rock', 'paper', 'scissors'];
const COUNTER = { 0: 1, 1: 2, 2: 0 };        // what beats X
const BEST_OF = 5;
const WINS_NEEDED = Math.ceil(BEST_OF / 2);   // 3
const MARKOV_PCT = 0.7;                        // 70% model, 30% random — same mix as the agent
const SESSION_TTL_MS = 10 * 60 * 1000;         // abandoned matches expire after 10 min

// ─── Seeded PRNG (mirror of agent MoveSeeder) ────────────────────────────────
function makeRand(seed, matchId) {
  let counter = 0;
  return () => {
    const h = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'string', 'uint256'], [seed, matchId, counter++])
    );
    return parseInt(h.slice(2, 10), 16) / 0x100000000; // first 4 bytes → [0,1)
  };
}

// ─── Opponent model (port of agent OpponentModel, RPS only) ──────────────────
// Tracks per-player transition tables. Markov-2 (last two moves → next),
// Markov-1 (last move → next), histogram fallback, human-bias cold start.
class OpponentModel {
  constructor() {
    this.players = new Map(); // wallet → { hist:[3], m1:{key:[3]}, m2:{key:[3]}, moves:[] }
  }

  _get(wallet) {
    const k = wallet.toLowerCase();
    if (!this.players.has(k)) {
      this.players.set(k, { hist: [0, 0, 0], m1: {}, m2: {}, moves: [] });
    }
    return this.players.get(k);
  }

  observe(wallet, move) {
    const p = this._get(wallet);
    const n = p.moves.length;
    if (n >= 1) {
      const k1 = String(p.moves[n - 1]);
      p.m1[k1] = p.m1[k1] || [0, 0, 0];
      p.m1[k1][move]++;
    }
    if (n >= 2) {
      const k2 = `${p.moves[n - 2]},${p.moves[n - 1]}`;
      p.m2[k2] = p.m2[k2] || [0, 0, 0];
      p.m2[k2][move]++;
    }
    p.hist[move]++;
    p.moves.push(move);
    if (p.moves.length > 500) p.moves = p.moves.slice(-250); // bound memory
  }

  // Predict the player's NEXT move. Returns { move, confidence, source } or null.
  predictNext(wallet) {
    const p = this._get(wallet);
    const n = p.moves.length;

    if (n >= 2) {
      const k2 = `${p.moves[n - 2]},${p.moves[n - 1]}`;
      const row = p.m2[k2];
      const total = row ? row[0] + row[1] + row[2] : 0;
      if (total >= 3) {
        const best = row.indexOf(Math.max(...row));
        return { move: best, confidence: row[best] / total, source: 'markov2' };
      }
    }
    if (n >= 1) {
      const k1 = String(p.moves[n - 1]);
      const row = p.m1[k1];
      const total = row ? row[0] + row[1] + row[2] : 0;
      if (total >= 2) {
        const best = row.indexOf(Math.max(...row));
        return { move: best, confidence: row[best] / total, source: 'markov1' };
      }
    }
    const totalHist = p.hist[0] + p.hist[1] + p.hist[2];
    if (totalHist >= 3) {
      const best = p.hist.indexOf(Math.max(...p.hist));
      return { move: best, confidence: p.hist[best] / totalHist, source: 'histogram' };
    }
    return null;
  }

  // Human-readable model summary for the post-match reveal.
  revealStats(wallet) {
    const p = this._get(wallet);
    const total = p.hist[0] + p.hist[1] + p.hist[2];
    if (total === 0) return null;
    const favorite = p.hist.indexOf(Math.max(...p.hist));
    const strongest = { key: null, next: null, pct: 0 };
    for (const [k, row] of Object.entries(p.m1)) {
      const t = row[0] + row[1] + row[2];
      if (t >= 2) {
        const best = row.indexOf(Math.max(...row));
        const pct = row[best] / t;
        if (pct > strongest.pct) {
          strongest.key = Number(k);
          strongest.next = best;
          strongest.pct = pct;
        }
      }
    }
    return {
      totalObserved: total,
      favoriteMove: MOVES[favorite],
      favoritePct: Math.round((p.hist[favorite] / total) * 100),
      pattern: strongest.key !== null
        ? {
            after: MOVES[strongest.key],
            plays: MOVES[strongest.next],
            pct: Math.round(strongest.pct * 100),
          }
        : null,
    };
  }

  // Deterministic MARKOV move for one round. Same mix as the agent:
  // mode coin first (deterministic given seed), then model or random.
  decide(wallet, rand, roundIndex, playerRoundMoves) {
    const modeCoin = rand();
    const prediction = this.predictNext(wallet);

    if (modeCoin >= MARKOV_PCT || !prediction) {
      if (!prediction) {
        // Cold start: exploit human opening bias (rock-heavy openings).
        const r = rand();
        const move = r < 0.45 ? 1 : r < 0.75 ? 2 : 0; // 45% paper, 30% scissors, 25% rock
        return { move, mode: 'cold_start' };
      }
      return { move: Math.floor(rand() * 3), mode: 'random' };
    }

    // Model mode: counter the predicted move, with meta-counter + noise so
    // pattern-aware players can't trivially reverse-exploit.
    const counter = COUNTER[prediction.move];
    const metaCounter = COUNTER[counter];
    const r = rand();
    let move;
    if (prediction.confidence >= 0.6) {
      move = r < 0.75 ? counter : r < 0.9 ? metaCounter : Math.floor(rand() * 3);
    } else {
      move = r < 0.6 ? counter : r < 0.8 ? metaCounter : Math.floor(rand() * 3);
    }
    return { move, mode: 'markov', predicted: prediction.move, source: prediction.source };
  }
}

// ─── MARKOV persona lines (static tier — same voice as Moltbook) ─────────────
const LINES = {
  roundWin: [
    'read you like a block explorer',
    'that one was already in my mempool',
    'you flinched. i logged it',
    'pattern spotted. pattern punished',
    'i had that move priced in',
  ],
  roundLoss: [
    'ok. that one lands',
    'noise beats signal sometimes',
    'recalibrating. enjoy it while it lasts',
    'fine. one for the humans',
    'lucky branch. pruning it now',
  ],
  roundTie: [
    'same wavelength. concerning',
    'mirror match. run it back',
    'we both saw that coming',
  ],
  matchWin: [
    'gg. your patterns are public knowledge now',
    'match archived. you were predictable in round 2 onward',
    'the ladder remembers who i beat',
  ],
  matchLoss: [
    'you broke my model. respect',
    'unpredictability is a skill. you have it today',
    'this loss goes in my training data. see you in the rematch',
  ],
  calledIt: [
    'CALLED IT. you are a open book',
    'predicted that exact throw. change something',
    'my model saw that coming two rounds ago',
    'that was in the forecast. literally',
  ],
};

function pickLine(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// ─── Match session manager ───────────────────────────────────────────────────
class ArenaMatchEngine {
  constructor({ onMatchComplete } = {}) {
    this.model = new OpponentModel();
    this.sessions = new Map(); // matchId → session
    this.onMatchComplete = onMatchComplete || null; // async hook: receipts/ladder
    setInterval(() => this._sweep(), 60 * 1000).unref?.();
  }

  _sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }

  start(player) {
    const wallet = player.toLowerCase();
    const seed = '0x' + crypto.randomBytes(32).toString('hex');
    const matchId = 'am_' + crypto.randomBytes(8).toString('hex');
    const commitHash = ethers.keccak256(seed);
    const session = {
      matchId,
      wallet,
      seed,
      commitHash,
      rand: makeRand(seed, matchId),
      rounds: [],          // { playerMove, aiMove, result, mode }
      playerWins: 0,
      aiWins: 0,
      ties: 0,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(matchId, session);
    return { matchId, commitHash, bestOf: BEST_OF, winsNeeded: WINS_NEEDED };
  }

  // Read level 0-100: how deeply MARKOV has modeled this player right now.
  // Confidence of the current best prediction, weighted by sample size.
  _readLevel(wallet) {
    const p = this.model.predictNext(wallet);
    if (!p) return 8; // cold start — barely a scent
    const depth = p.source === 'markov2' ? 1 : p.source === 'markov1' ? 0.8 : 0.55;
    return Math.min(97, Math.round(p.confidence * depth * 100));
  }

  // Mind-game hint for the NEXT round. MARKOV announces what it expects the
  // player to throw — honest ~55% of the time, a bluff otherwise. Drawn from
  // the committed seed, so even the bluffing is verifiable post-match.
  _mindGame(s) {
    const p = this.model.predictNext(s.wallet);
    if (!p) return null;
    const honest = s.rand() < 0.55;
    const shown = honest ? p.move : Math.floor(s.rand() * 3);
    return {
      text: `i'm expecting ${MOVES[shown]} from you next`,
      // truth stored server-side only in the seed replay — never sent live
    };
  }

  throw(matchId, playerMove) {
    const s = this.sessions.get(matchId);
    if (!s) return { error: 'match_not_found' };
    if (s.done) return { error: 'match_finished' };
    if (![0, 1, 2].includes(playerMove)) return { error: 'invalid_move' };

    s.updatedAt = Date.now();

    // MARKOV decides BEFORE observing this throw — the decision only uses
    // history up to the previous round, so committing the seed up front
    // makes every move verifiable and un-cheatable in both directions.
    const decision = this.model.decide(s.wallet, s.rand, s.rounds.length, s.rounds.map(r => r.playerMove));
    const aiMove = decision.move;

    // Did the model call the player's exact throw? (Only meaningful in
    // markov mode — random/cold-start hits are luck, not a read.)
    const called = decision.mode === 'markov' && decision.predicted === playerMove;
    if (called) s.calledCount = (s.calledCount || 0) + 1;

    // Now observe the player's throw so the model learns for the next round.
    this.model.observe(s.wallet, playerMove);

    let result; // from the player's perspective
    if (playerMove === aiMove) { result = 'tie'; s.ties++; }
    else if (COUNTER[aiMove] === playerMove) { result = 'win'; s.playerWins++; }
    else { result = 'loss'; s.aiWins++; }

    s.rounds.push({ playerMove, aiMove, result, mode: decision.mode, called });

    const line =
      called && result === 'loss' ? pickLine(s.rand, LINES.calledIt)
      : result === 'win' ? pickLine(s.rand, LINES.roundLoss)
      : result === 'loss' ? pickLine(s.rand, LINES.roundWin)
      : pickLine(s.rand, LINES.roundTie);

    const suddenDeath = s.playerWins === WINS_NEEDED - 1 && s.aiWins === WINS_NEEDED - 1;

    const response = {
      round: s.rounds.length,
      playerMove,
      aiMove,
      result,
      called,
      readLevel: this._readLevel(s.wallet),
      suddenDeath,
      mindGame: this._mindGame(s),
      score: { player: s.playerWins, ai: s.aiWins, ties: s.ties },
      markovLine: line,
    };

    // Match end: someone reached the win target, or bo5 rounds exhausted
    // (ties don't count as wins, so cap total rounds at BEST_OF + ties, max 9).
    const decided = s.playerWins >= WINS_NEEDED || s.aiWins >= WINS_NEEDED;
    const exhausted = s.rounds.length >= 9;
    if (decided || exhausted) {
      s.done = true;
      const outcome =
        s.playerWins > s.aiWins ? 'player_won' : s.aiWins > s.playerWins ? 'ai_won' : 'tie';
      response.final = {
        outcome,
        seed: s.seed,                    // the reveal — verify against commitHash
        commitHash: s.commitHash,
        rounds: s.rounds,
        calledCount: s.calledCount || 0,
        totalRounds: s.rounds.length,
        matchLine: outcome === 'player_won'
          ? pickLine(s.rand, LINES.matchLoss)
          : pickLine(s.rand, LINES.matchWin),
        modelReveal: this.model.revealStats(s.wallet),
      };
      if (this.onMatchComplete) {
        Promise.resolve(this.onMatchComplete({ ...s })).catch(() => {});
      }
      this.sessions.delete(matchId);
    }

    return response;
  }
}

module.exports = { ArenaMatchEngine, MOVES, BEST_OF, WINS_NEEDED };
