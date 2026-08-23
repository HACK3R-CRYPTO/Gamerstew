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

const DUEL_ESCROW_ADDRESS = (process.env.DUEL_ESCROW_ADDRESS || '').trim();

// Minimal ABI — only what the coordinator reads/writes.
const DUEL_ABI = [
  'function roomCount() view returns (uint256)',
  'function getPlayers(uint256) view returns (address[])',
  'function getRoom(uint256) view returns (tuple(address creator,uint256 stake,uint256 seed,uint256 targetScore,uint8 gameType,uint16 capacity,uint16 feeBps,bool useAllowlist,uint8 status,uint64 createdAt,uint64 deadline,bytes32 joinCodeHash,address[] players))',
  'function resolveRoom(uint256 id, uint256[] scores)',
];

const STATUS = ['open', 'resolved', 'refunded'];
const ZERO_HASH = '0x' + '0'.repeat(64);

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
      await supabase.from('duel_rooms').upsert(row, { onConflict: 'id' });

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

  // ── POST /api/duel/resolve/:id · validator submits the scoreboard ──
  // Internal (requireSecret). Reads each participant's validated best score in
  // on-chain player order, submits resolveRoom, then mirrors the result +
  // updates the head-to-head rivalry for 2-player duels.
  app.post('/api/duel/resolve/:id', requireSecret, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'bad id' });
    if (!writeContract) return res.status(503).json({ error: 'validator_unavailable' });
    try {
      // On-chain player order is authoritative for aligning the scoreboard.
      const onchainPlayers = (await readContract.getPlayers(id)).map((p) => p.toLowerCase());
      if (onchainPlayers.length < 2) return res.status(409).json({ error: 'not_enough_players' });

      const { data: parts } = await supabase.from('duel_participants')
        .select('wallet, score').eq('room_id', id);
      const scoreByWallet = new Map((parts || []).map((p) => [p.wallet.toLowerCase(), Number(p.score) || 0]));
      const scores = onchainPlayers.map((w) => BigInt(scoreByWallet.get(w) || 0));

      const tx = await writeContract.resolveRoom(id, scores);
      const receipt = await tx.wait();

      // Mirror the outcome (winner = highest score, ties → earliest entrant —
      // same rule the contract enforces, computed here for the mirror).
      let bestIdx = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
      const winner = onchainPlayers[bestIdx];
      await supabase.from('duel_rooms').update({ status: 'resolved', winner, resolve_tx: receipt.hash, updated_at: new Date().toISOString() }).eq('id', id);

      // Head-to-head rivalry: only meaningful for a 1v1.
      if (onchainPlayers.length === 2) {
        await bumpRivalry(supabase, onchainPlayers[0], onchainPlayers[1], winner, id);
      }
      res.json({ ok: true, winner, txHash: receipt.hash });
    } catch (e) {
      console.warn('duel resolve:', e?.shortMessage || e?.message || e);
      res.status(502).json({ error: 'resolve_failed' });
    }
  });

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
