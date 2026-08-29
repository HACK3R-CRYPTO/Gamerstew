// ─── Private Sprint · live board ─────────────────────────────────────────────
// A read-only, invite-only leaderboard for the hand-picked 5-day sprint. Same
// scoring as the Arena Cup skill lane (best run per game, normalised) but scoped
// to a fixed roster and the 3 skill games (0 rhythm, 1 simon, 2 stack). The
// end-of-sprint payout is done by scripts/payout-saturday-pool.js with the SAME
// roster/window/games, so the board a player sees IS what gets paid.
//
// GET /api/sprint?wallet=0x...  ->  { event, board[], viewer, prizeLadder }
//   - board is only returned to a roster wallet or the host (kept private).
//   - viewer.allowed says whether this wallet may see it; viewer.rank/score if in.

const fs = require('fs');
const path = require('path');

const SUBGRAPH = process.env.SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn';

// Keep these in lockstep with scripts/run-sprint.sh.
const SPRINT = {
  title: 'Private Sprint',
  startsAt: process.env.SPRINT_STARTS_AT || '2026-09-01T00:00:00Z',
  endsAt:   process.env.SPRINT_ENDS_AT   || '2026-09-06T00:00:00Z',
  games: [0, 1, 2],                    // rhythm, simon, stack
  poolG: Number(process.env.SPRINT_POOL_G || 430000),
  usd: 50,
  winners: Number(process.env.SPRINT_WINNERS || 10),
  split: 'graduated',
};
const DIVISOR = { 0: 100, 1: 20, 2: 5 };
const GAME_NAME = { 0: 'Rhythm Rush', 1: 'Simon Memory', 2: 'Stack' };
// The host(s) who can always see the room even though they don't compete.
const HOSTS = new Set([
  '0xa479b8c6030cbb01f8e9f6acb2ad2c757c81894d', // ogazboiz
]);

// Roster: scripts/sprint-players.txt — "0xwallet  # Name" lines.
function loadRoster() {
  const file = path.join(__dirname, '..', 'scripts', 'sprint-players.txt');
  const out = new Map(); // wallet -> name
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*(0x[0-9a-fA-F]{40})\s*(?:#\s*(.*))?$/);
    if (m) out.set(m[1].toLowerCase(), (m[2] || '').trim() || null);
  }
  return out;
}

async function gql(query, variables) {
  const r = await fetch(SUBGRAPH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

// Best run per (roster player, game) inside the window -> normalised total.
async function rankRoster(roster, startSec, endSec) {
  const best = new Map(); // wallet -> Map(game -> best)
  let cursor = startSec;
  for (let page = 0; page < 60; page++) {
    const data = await gql(
      `query($s:BigInt!,$e:BigInt!){ scores(first:1000, orderBy: blockTimestamp, orderDirection: asc,
        where:{ blockTimestamp_gte:$s, blockTimestamp_lt:$e }){ player{ id } gameType score blockTimestamp } }`,
      { s: String(cursor), e: String(endSec) },
    );
    const rows = data.scores || [];
    if (!rows.length) break;
    for (const row of rows) {
      const w = row.player.id.toLowerCase();
      if (!roster.has(w)) continue;
      const g = Number(row.gameType);
      if (!SPRINT.games.includes(g)) continue;
      const sc = Number(row.score);
      if (!best.has(w)) best.set(w, new Map());
      const m = best.get(w);
      if (!m.has(g) || sc > m.get(g)) m.set(g, sc);
    }
    if (rows.length < 1000) break;
    cursor = Number(rows[rows.length - 1].blockTimestamp) + 1;
  }
  const scored = [];
  for (const [w, m] of best) {
    let total = 0; const per = {};
    for (const [g, sc] of m) { const n = Math.floor(sc / (DIVISOR[g] || 20)); per[g] = n; total += n; }
    scored.push({ wallet: w, score: total, per });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// Graduated split of poolG among a full field of `winners` (stable ladder).
function prizeLadder() {
  const n = SPRINT.winners;
  const weights = Array.from({ length: n }, (_, i) => n - i);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((wt) => Math.floor((SPRINT.poolG * wt) / wsum));
  raw[0] += SPRINT.poolG - raw.reduce((a, b) => a + b, 0);
  return raw; // index 0 = #1
}

function registerSprintRoutes(app) {
  app.get('/api/sprint', async (req, res) => {
    const wallet = String(req.query.wallet || '').toLowerCase();
    const roster = loadRoster();
    const isRoster = roster.has(wallet);
    const isHost = HOSTS.has(wallet);
    const allowed = isRoster || isHost;

    const event = {
      title: SPRINT.title,
      startsAt: SPRINT.startsAt,
      endsAt: SPRINT.endsAt,
      usd: SPRINT.usd,
      poolG: SPRINT.poolG,
      winners: SPRINT.winners,
      games: SPRINT.games.map((g) => ({ type: g, name: GAME_NAME[g] })),
      rosterSize: roster.size,
    };

    if (!allowed) return res.json({ event, viewer: { allowed: false }, board: [] });

    const ladder = prizeLadder();
    let scored = [];
    try {
      const startSec = Math.floor(Date.parse(SPRINT.startsAt) / 1000);
      const endSec = Math.floor(Date.parse(SPRINT.endsAt) / 1000);
      scored = await rankRoster(roster, startSec, endSec);
    } catch (e) {
      console.warn('sprint rank failed:', e?.message || e);
    }
    const scoreByWallet = new Map(scored.map((s) => [s.wallet, s]));

    // Full board = every roster member, scored first (desc), then not-yet-played.
    const board = [];
    scored.forEach((s, i) => board.push({
      rank: i + 1, wallet: s.wallet, name: roster.get(s.wallet) || null,
      score: s.score, per: s.per, prizeG: i < SPRINT.winners ? ladder[i] : 0,
      you: s.wallet === wallet,
    }));
    for (const [w, name] of roster) {
      if (scoreByWallet.has(w)) continue;
      board.push({ rank: null, wallet: w, name, score: 0, per: {}, prizeG: 0, you: w === wallet });
    }

    const meRow = board.find((r) => r.you) || null;
    res.json({
      event,
      prizeLadder: ladder,
      viewer: { allowed: true, isHost, isRoster, rank: meRow?.rank ?? null, score: meRow?.score ?? 0 },
      board,
    });
  });
}

module.exports = { registerSprintRoutes };
