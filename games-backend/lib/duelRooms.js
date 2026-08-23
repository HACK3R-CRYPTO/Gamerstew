// ─── Duel Rooms · backend module ─────────────────────────────────────────────
// The DuelEscrow contract is the source of truth for funds, membership, and
// resolution. This module is a thin coordinator:
//   • sync   — read on-chain room state and mirror it to Supabase (for the hub)
//   • rooms  — list public open rooms for the Challenges hub
//   • room   — one room's detail (mirror, reconciled)
//   • resolve— (validator-only) submit the scoreboard so the contract pays out
//   • rivalry— head-to-head record between two players
//
// It never holds funds. Players create/join on-chain from their own wallet
// (permit saves the approve tx; the faucet covers the tiny gas, same as skill
// games). The only key this module uses is the existing validator, to resolve.
//
// Register from server.js:
//   require('./lib/duelRooms').registerDuelRoutes(app, { supabase, provider, validator, isVerified, requireSecret });

const { ethers } = require('ethers');
const { gql } = require('./subgraph');

const DUEL_ESCROW_ADDRESS = (process.env.DUEL_ESCROW_ADDRESS || '').trim();

// Minimal ABI — only what the coordinator reads/writes.
const DUEL_ABI = [
  'function roomCount() view returns (uint256)',
  'function getPlayers(uint256) view returns (address[])',
  'function getRoom(uint256) view returns (tuple(address creator,uint256 stake,uint256 seed,uint256 targetScore,uint8 gameType,uint16 capacity,uint16 feeBps,bool useAllowlist,uint8 status,uint64 createdAt,uint64 deadline,bytes32 joinCodeHash,address[] players))',
  'function resolveRoom(uint256 id, uint256[] scores)',
  'function refundAll(uint256 id)',
];

const STATUS = ['open', 'resolved', 'refunded'];
const ZERO_HASH = '0x' + '0'.repeat(64);

// Cross-game normalisation (same scale the Arena Cup uses), so a room spanning
// several games is fair: a player's room score = Σ floor(bestRun_game / divisor).
const DUEL_DIVISOR = { 0: 100, 1: 20, 2: 5, 3: 20 };

// Best validated run per (player, game) in a window, from the subgraph (the same
// immutable Score rows the Cup reads). Returns Map(playerLower -> Map(game -> best)).
async function bestRunsInWindow(players, games, startSec, endSec) {
  const out = new Map();
  if (!players.length || !games.length || endSec <= startSec) return out;
  try {
    const data = await gql(
      `query($p:[String!],$g:[Int!],$s:BigInt!,$e:BigInt!){
        scores(first:1000, where:{ player_in:$p, gameType_in:$g, blockTimestamp_gte:$s, blockTimestamp_lt:$e }){
          player{ id } gameType score
        }
      }`,
      { p: players, g: games, s: String(startSec), e: String(endSec) },
    );
    for (const row of (data && data.scores) || []) {
      const w = row.player.id.toLowerCase();
      const g = Number(row.gameType);
      const sc = Number(row.score);
      if (!out.has(w)) out.set(w, new Map());
      const m = out.get(w);
      if (!m.has(g) || sc > m.get(g)) m.set(g, sc);
    }
  } catch (e) { console.warn('duel bestRuns:', e?.message || e); }
  return out;
}

// A player's normalised room score across the room's games.
function normalisedScore(bestByGame, games) {
  if (!bestByGame) return 0;
  let total = 0;
  for (const g of games) {
    const best = bestByGame.get(g) || 0;
    total += Math.floor(best / (DUEL_DIVISOR[g] || 20));
  }
  return total;
}

function registerDuelRoutes(app, deps) {
  const { supabase, provider, validator, requireSecret } = deps;

  if (!DUEL_ESCROW_ADDRESS || !provider) {
    console.log('ℹ️  DUEL_ESCROW_ADDRESS or provider not set — duel rooms disabled');
    // Still register a health route so the frontend proxy gets a clean 503.
    app.get('/api/duel/rooms', (_, res) => res.json({ rooms: [], disabled: true }));
    return;
  }

  const readContract = new ethers.Contract(DUEL_ESCROW_ADDRESS, DUEL_ABI, provider);
  const writeContract = validator ? new ethers.Contract(DUEL_ESCROW_ADDRESS, DUEL_ABI, validator) : null;

  // Map on-chain room → mirror row shape.
  function toRow(id, r) {
    const isPrivate = r.joinCodeHash !== ZERO_HASH || r.useAllowlist;
    const gating = r.useAllowlist ? 'allowlist' : (r.joinCodeHash !== ZERO_HASH ? 'code' : 'open');
    return {
      id: Number(id),
      creator: r.creator.toLowerCase(),
      game_type: Number(r.gameType),
      visibility: isPrivate ? 'private' : 'public',
      gating,
      stake_wei: r.stake.toString(),
      seed_wei: r.seed.toString(),
      fee_bps: Number(r.feeBps),
      capacity: Number(r.capacity),
      deadline: new Date(Number(r.deadline) * 1000).toISOString(),
      status: STATUS[Number(r.status)] || 'open',
      updated_at: new Date().toISOString(),
    };
  }

  // ── POST /api/duel/sync/:id · mirror one room from chain (trustless read) ──
  // Called by the client right after create/join. Reads on-chain state (no trust
  // in client input beyond the id) and upserts the mirror + participants.
  app.post('/api/duel/sync/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    try {
      const r = await readContract.getRoom(id);
      if (r.creator === ethers.ZeroAddress) return res.status(404).json({ error: 'no such room' });
      const row = toRow(id, r);
      row.created_at = new Date(Number(r.createdAt) * 1000).toISOString();
      // Off-chain: the full set of games this room spans (the contract only stores
      // one representative gameType). Sent by the client at create time.
      const games = Array.isArray(req.body?.games)
        ? [...new Set(req.body.games.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 3))]
        : null;
      if (games && games.length) row.games = games;
      // Off-chain start time (when scoring opens). Only accept a value inside the
      // room's own lifetime; otherwise treat "start = created" (live immediately).
      const startsAtNum = Number(req.body?.startsAt);
      if (Number.isFinite(startsAtNum) && startsAtNum > Number(r.createdAt) && startsAtNum < Number(r.deadline)) {
        row.starts_at = new Date(startsAtNum * 1000).toISOString();
      }
      let { error: upErr } = await supabase.from('duel_rooms').upsert(row, { onConflict: 'id' });
      // Optional columns (games / starts_at) may not be migrated yet — retry
      // without them so room creation never breaks on a pending migration.
      if (upErr && (row.games || row.starts_at)) {
        delete row.games; delete row.starts_at;
        ({ error: upErr } = await supabase.from('duel_rooms').upsert(row, { onConflict: 'id' }));
      }
      if (upErr) throw upErr;

      // Participants in on-chain order (join_index aligns the scoreboard later).
      const players = r.players.map((p) => p.toLowerCase());
      const rows = players.map((wallet, i) => ({ room_id: id, wallet, join_index: i }));
      if (rows.length) await supabase.from('duel_participants').upsert(rows, { onConflict: 'room_id,wallet' });
      res.json({ ok: true, room: row, players });
    } catch (e) {
      console.warn('duel sync:', e?.shortMessage || e?.message || e);
      res.status(502).json({ error: 'sync_failed' });
    }
  });

  // ── GET /api/duel/rooms · the Challenges hub feed (public, open, not expired) ──
  app.get('/api/duel/rooms', async (_req, res) => {
    try {
      const nowIso = new Date().toISOString();
      const { data } = await supabase.from('duel_rooms')
        .select('*')
        .eq('visibility', 'public').eq('status', 'open').gt('deadline', nowIso)
        .order('created_at', { ascending: false }).limit(50);
      res.json({ rooms: data || [] });
    } catch (e) {
      console.warn('duel rooms:', e?.message || e);
      res.json({ rooms: [] });
    }
  });

  // ── GET /api/duel/my?wallet= · rooms this player is in (public + private) ──
  // Surfaces a player's own rooms — including private pools they've joined that
  // never appear in the public hub. This is how the community sees "their" event.
  app.get('/api/duel/my', async (req, res) => {
    const wallet = String(req.query.wallet || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return res.status(400).json({ error: 'wallet required' });
    try {
      const { data: parts } = await supabase.from('duel_participants').select('room_id').eq('wallet', wallet);
      const ids = [...new Set((parts || []).map((p) => p.room_id))];
      if (!ids.length) return res.json({ rooms: [] });
      const { data: rooms } = await supabase.from('duel_rooms').select('*').in('id', ids).order('created_at', { ascending: false });
      res.json({ rooms: rooms || [] });
    } catch (e) {
      console.warn('duel my:', e?.message || e);
      res.json({ rooms: [] });
    }
  });

  // ── GET /api/duel/room/:id · one room's detail + its participants ──
  app.get('/api/duel/room/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    try {
      const { data: room } = await supabase.from('duel_rooms').select('*').eq('id', id).maybeSingle();
      if (!room) return res.status(404).json({ error: 'not_found' });
      const { data: players } = await supabase.from('duel_participants')
        .select('wallet, join_index, score').eq('room_id', id).order('join_index');
      res.json({ room, players: players || [] });
    } catch (e) {
      console.warn('duel room:', e?.message || e);
      res.status(500).json({ error: 'failed' });
    }
  });

  // ── Resolve a room · compute normalised scores from the subgraph, pay out ──
  // The player just plays normally (their runs are recorded on-chain and
  // indexed), so there's no separate "duel mode": here we read each player's
  // best runs in the room's games during the room window, normalise across
  // games, and submit the scoreboard. If nobody scored, refund instead of
  // handing the pot to an arbitrary entrant. Returns a small status object.
  async function resolveRoomById(id) {
    if (!writeContract) return { skip: 'no_validator' };
    const r = await readContract.getRoom(id);
    if (r.creator === ethers.ZeroAddress) return { skip: 'no_room' };
    if (Number(r.status) !== 0) return { skip: 'not_open' };
    const players = r.players.map((p) => p.toLowerCase());
    if (players.length < 2) return { skip: 'need_2' };
    const nowSec = Math.floor(Date.now() / 1000);
    const deadline = Number(r.deadline);

    // The room's games + off-chain start time.
    const { data: mirror } = await supabase.from('duel_rooms').select('games, starts_at').eq('id', id).maybeSingle();
    const games = (mirror && Array.isArray(mirror.games) && mirror.games.length)
      ? mirror.games.map(Number) : [Number(r.gameType)];
    const startSec = mirror && mirror.starts_at ? Math.floor(Date.parse(mirror.starts_at) / 1000) : Number(r.createdAt);

    // Resolve only after the end, or when full AND scoring has already started
    // (never crown a full room before its start time).
    const full = players.length === Number(r.capacity);
    const resolvable = nowSec > deadline || (full && nowSec >= startSec);
    if (!resolvable) return { skip: 'still_live' };

    // Score window: start time → end (capped at now).
    const endSec = Math.min(nowSec, deadline) + (full && nowSec <= deadline ? 1 : 0);
    const best = await bestRunsInWindow(players, games, startSec, Math.max(startSec + 1, endSec));
    const scoresNum = players.map((w) => normalisedScore(best.get(w), games));

    // Nobody posted a score → refund everyone rather than crown a non-player.
    if (scoresNum.every((s) => s === 0)) {
      const tx = await writeContract.refundAll(id);
      const rc = await tx.wait();
      await supabase.from('duel_rooms').update({ status: 'refunded', resolve_tx: rc.hash, updated_at: new Date().toISOString() }).eq('id', id);
      return { refunded: true, txHash: rc.hash };
    }

    const tx = await writeContract.resolveRoom(id, scoresNum.map((s) => BigInt(s)));
    const rc = await tx.wait();

    // Winner = highest score, ties → earliest entrant (same as the contract).
    let bestIdx = 0;
    for (let i = 1; i < scoresNum.length; i++) if (scoresNum[i] > scoresNum[bestIdx]) bestIdx = i;
    const winner = players[bestIdx];
    await supabase.from('duel_rooms').update({ status: 'resolved', winner, resolve_tx: rc.hash, updated_at: new Date().toISOString() }).eq('id', id);
    // Persist each player's final score for the room UI.
    await Promise.all(players.map((w, i) => supabase.from('duel_participants').update({ score: scoresNum[i] }).eq('room_id', id).eq('wallet', w)));
    if (players.length === 2) await bumpRivalry(supabase, players[0], players[1], winner, id);
    return { resolved: true, winner, txHash: rc.hash };
  }

  // ── POST /api/duel/resolve/:id · manual trigger (internal) ──
  app.post('/api/duel/resolve/:id', requireSecret, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    try {
      const out = await resolveRoomById(id);
      if (out.skip) return res.status(409).json({ error: out.skip });
      res.json({ ok: true, ...out });
    } catch (e) {
      console.warn('duel resolve:', e?.shortMessage || e?.message || e);
      res.status(502).json({ error: 'resolve_failed' });
    }
  });

  // ── Auto-resolve cron · every ~2 min, settle any room that's full or past
  // its deadline. Best-effort; failures are logged and retried next tick. ──
  if (writeContract) {
    const sweep = async () => {
      try {
        const nowIso = new Date().toISOString();
        // Candidates: open rooms that are past deadline (full-room early resolve
        // is handled on the next tick too — cheap to re-check on-chain).
        const { data: rooms } = await supabase.from('duel_rooms')
          .select('id').eq('status', 'open').lt('deadline', nowIso).limit(50);
        for (const room of rooms || []) {
          try {
            const out = await resolveRoomById(room.id);
            if (out.resolved) console.log(`⚔️  Duel room ${room.id} resolved · winner ${out.winner.slice(0, 10)}… · ${out.txHash}`);
            else if (out.refunded) console.log(`⚔️  Duel room ${room.id} refunded (no scores) · ${out.txHash}`);
          } catch (e) { console.warn(`duel sweep room ${room.id}:`, e?.shortMessage || e?.message || e); }
        }
      } catch (e) { console.warn('duel sweep:', e?.message || e); }
    };
    const _t = setInterval(sweep, 2 * 60 * 1000);
    if (_t.unref) _t.unref();
    setTimeout(sweep, 20 * 1000); // one pass shortly after boot
  }

  // ── GET /api/duel/rivalry?a=&b= · head-to-head record ──
  app.get('/api/duel/rivalry', async (req, res) => {
    const a = String(req.query.a || '').toLowerCase();
    const b = String(req.query.b || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a) || !/^0x[0-9a-f]{40}$/.test(b)) return res.status(400).json({ error: 'two wallets required' });
    const [lo, hi] = a < b ? [a, b] : [b, a];
    try {
      const { data } = await supabase.from('duel_rivalries').select('*').eq('wallet_lo', lo).eq('wallet_hi', hi).maybeSingle();
      const winsA = a === lo ? (data?.wins_lo ?? 0) : (data?.wins_hi ?? 0);
      const winsB = a === lo ? (data?.wins_hi ?? 0) : (data?.wins_lo ?? 0);
      res.json({ a, b, winsA, winsB, ties: data?.ties ?? 0, lastPlayed: data?.last_played ?? null });
    } catch (e) {
      res.json({ a, b, winsA: 0, winsB: 0, ties: 0, lastPlayed: null });
    }
  });
}

// Upsert the ordered-pair rivalry row and attribute the win.
async function bumpRivalry(supabase, p0, p1, winner, roomId) {
  const [lo, hi] = p0 < p1 ? [p0, p1] : [p1, p0];
  const { data: row } = await supabase.from('duel_rivalries').select('*').eq('wallet_lo', lo).eq('wallet_hi', hi).maybeSingle();
  const next = {
    wallet_lo: lo, wallet_hi: hi,
    wins_lo: row?.wins_lo ?? 0, wins_hi: row?.wins_hi ?? 0, ties: row?.ties ?? 0,
    last_room: roomId, last_played: new Date().toISOString(),
  };
  if (winner === lo) next.wins_lo++;
  else if (winner === hi) next.wins_hi++;
  else next.ties++;
  await supabase.from('duel_rivalries').upsert(next, { onConflict: 'wallet_lo,wallet_hi' });
}

module.exports = { registerDuelRoutes };
