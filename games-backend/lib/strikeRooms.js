// ─── Street Strike online rooms ──────────────────────────────────────────────
// A friend lane: one player makes a room, shares its 5-letter code, and up to
// four people bowl AT THE SAME TIME, each on their own phone, watching each
// other's scorecards fill in. Nobody waits for a turn, so a slow connection or
// a slow friend never freezes the game.
//
// This is a free, casual game: no stakes, no chain, no database. Rooms live in
// memory and expire. A restart drops live rooms, which costs a rematch and
// nothing else. The server keeps each player's list of rolls and checks that it
// is a legal bowling card; the phones do the physics.
//
//   POST /api/strike/rooms                 { name }          → { code, token, seat }
//   POST /api/strike/rooms/:code/join      { name }          → { token, seat }
//   GET  /api/strike/rooms/:code?token=                      → room
//   POST /api/strike/rooms/:code/start     { token }         (host)
//   POST /api/strike/rooms/:code/roll      { token, rolls }  (your whole card so far)
//   POST /api/strike/rooms/:code/rematch   { token }         (host)
//   POST /api/strike/rooms/:code/leave     { token }
//
// Register from server.js:
//   require('./lib/strikeRooms').registerStrikeRoutes(app, { requireSecret });

const crypto = require('crypto');

const FRAMES = 5;
const PINS = 10;
const MAX_PLAYERS = 4;
const MAX_ROOMS = 2000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // a room nobody touches for two hours is gone
const AWAY_MS = 30 * 1000; // no word from a phone for this long: stop waiting for it
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

// Walk a list of rolls as a bowling card. Returns null if it is not a legal one.
function readCard(rolls, frames = FRAMES) {
  if (!Array.isArray(rolls) || rolls.length > frames * 2 + 1) return null;
  let i = 0;
  for (let f = 0; f < frames; f++) {
    if (i >= rolls.length) return { done: false, frame: f };
    const a = rolls[i];
    if (!Number.isInteger(a) || a < 0 || a > PINS) return null;
    const last = f === frames - 1;
    if (!last) {
      if (a === PINS) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { done: false, frame: f };
      const b = rolls[i + 1];
      if (!Number.isInteger(b) || b < 0 || a + b > PINS) return null;
      i += 2;
      continue;
    }
    // last frame: a strike or a spare earns one more roll
    if (i + 1 >= rolls.length) return { done: false, frame: f };
    const b = rolls[i + 1];
    if (!Number.isInteger(b) || b < 0 || b > PINS) return null;
    if (a < PINS && a + b > PINS) return null;
    const bonus = a === PINS || a + b === PINS;
    if (!bonus) return i + 2 === rolls.length ? { done: true, frame: frames } : null;
    if (i + 2 >= rolls.length) return { done: false, frame: f };
    const c = rolls[i + 2];
    if (!Number.isInteger(c) || c < 0 || c > PINS) return null;
    if (a === PINS && b < PINS && b + c > PINS) return null;
    return i + 3 === rolls.length ? { done: true, frame: frames } : null;
  }
  return i === rolls.length ? { done: true, frame: frames } : null;
}

function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14);
  return s || 'Player';
}

function createStore(now = () => Date.now()) {
  const rooms = new Map();

  function sweep() {
    const t = now();
    for (const [code, r] of rooms) if (t - r.touched > ROOM_TTL_MS) rooms.delete(code);
  }
  function newCode() {
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      const bytes = crypto.randomBytes(5);
      for (let i = 0; i < 5; i++) c += ALPHABET[bytes[i] % ALPHABET.length];
      if (!rooms.has(c)) return c;
    }
    return null;
  }
  const newToken = () => crypto.randomBytes(16).toString('hex');
  const find = (code) => rooms.get(String(code || '').toUpperCase());
  const seatOf = (room, token) => (typeof token === 'string' && token.length === 32 ? room.players.findIndex((p) => p.token === token) : -1);

  // Everyone still here has finished. A phone that went quiet does not hold the room.
  function settle(room) {
    if (room.status !== 'playing') return;
    const t = now();
    const live = room.players.filter((p) => !p.left && t - p.seen < AWAY_MS);
    if (room.players.every((p) => p.done || p.left || t - p.seen >= AWAY_MS) && (live.length === 0 || live.every((p) => p.done))) room.status = 'over';
  }

  function view(room, seat) {
    const t = now();
    settle(room);
    return {
      code: room.code,
      status: room.status,
      round: room.round,
      frames: FRAMES,
      you: seat,
      players: room.players.map((p, i) => ({ name: p.name, host: i === 0, rolls: p.rolls, done: p.done, away: p.left || t - p.seen >= AWAY_MS })),
    };
  }

  return {
    create(name) {
      sweep();
      if (rooms.size >= MAX_ROOMS) return { error: 'busy', status: 503 };
      const code = newCode();
      if (!code) return { error: 'busy', status: 503 };
      const token = newToken();
      const t = now();
      rooms.set(code, { code, status: 'waiting', round: 0, touched: t, players: [{ name: cleanName(name), token, rolls: [], done: false, seen: t, left: false }] });
      return { code, token, seat: 0 };
    },
    join(code, name) {
      const room = find(code);
      if (!room) return { error: 'no_room', status: 404 };
      if (room.status !== 'waiting') return { error: 'started', status: 409 };
      if (room.players.length >= MAX_PLAYERS) return { error: 'full', status: 409 };
      const token = newToken();
      const t = now();
      // two players with one name would be impossible to tell apart on the card
      let n = cleanName(name);
      if (room.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${n.slice(0, 12)} ${room.players.length + 1}`;
      room.players.push({ name: n, token, rolls: [], done: false, seen: t, left: false });
      room.touched = t;
      return { code: room.code, token, seat: room.players.length - 1 };
    },
    get(code, token) {
      const room = find(code);
      if (!room) return { error: 'no_room', status: 404 };
      const seat = seatOf(room, token);
      if (seat >= 0) { room.players[seat].seen = now(); room.touched = now(); }
      return view(room, seat);
    },
    start(code, token) {
      const room = find(code);
      if (!room) return { error: 'no_room', status: 404 };
      const seat = seatOf(room, token);
      if (seat !== 0) return { error: 'not_host', status: 403 };
      if (room.status !== 'waiting') return { error: 'started', status: 409 };
      if (room.players.filter((p) => !p.left).length < 2) return { error: 'need_two', status: 409 };
      room.status = 'playing';
      room.round += 1;
      room.touched = now();
      return view(room, seat);
    },
    roll(code, token, rolls) {
      const room = find(code);
      if (!room) return { error: 'no_room', status: 404 };
      const seat = seatOf(room, token);
      if (seat < 0) return { error: 'not_in_room', status: 403 };
      if (room.status !== 'playing') return { error: 'not_playing', status: 409 };
      const p = room.players[seat];
      const card = readCard(rolls);
      if (!card) return { error: 'bad_card', status: 400 };
      // a card only ever grows: the rolls already reported cannot change
      if (rolls.length < p.rolls.length || p.rolls.some((v, i) => rolls[i] !== v)) return { error: 'rewrite', status: 409 };
      p.rolls = rolls.slice();
      p.done = card.done;
      p.seen = now();
      room.touched = now();
      return view(room, seat);
    },
    rematch(code, token) {
      const room = find(code);
      if (!room) return { error: 'no_room', status: 404 };
      const seat = seatOf(room, token);
      if (seat !== 0) return { error: 'not_host', status: 403 };
      settle(room);
      if (room.status !== 'over') return { error: 'not_over', status: 409 };
      for (const p of room.players) { p.rolls = []; p.done = false; }
      room.status = 'playing';
      room.round += 1;
      room.touched = now();
      return view(room, seat);
    },
    leave(code, token) {
      const room = find(code);
      if (!room) return { ok: true };
      const seat = seatOf(room, token);
      if (seat >= 0) {
        if (room.status === 'waiting' && seat !== 0) room.players.splice(seat, 1);
        else room.players[seat].left = true;
        if (room.players.every((p) => p.left)) rooms.delete(room.code);
      }
      return { ok: true };
    },
    size: () => rooms.size,
  };
}

function registerStrikeRoutes(app, deps = {}) {
  const store = deps.store || createStore();
  // Calls arrive from our own frontend server, carrying the internal secret.
  const gate = deps.requireSecret || ((_req, _res, next) => next());
  const send = (res, out) => (out && out.error ? res.status(out.status || 400).json({ error: out.error }) : res.json(out));
  const str = (v) => (typeof v === 'string' ? v : '');

  app.post('/api/strike/rooms', gate, (req, res) => send(res, store.create(req.body && req.body.name)));
  app.post('/api/strike/rooms/:code/join', gate, (req, res) => send(res, store.join(req.params.code, req.body && req.body.name)));
  app.get('/api/strike/rooms/:code', gate, (req, res) => send(res, store.get(req.params.code, str(req.query.token))));
  app.post('/api/strike/rooms/:code/start', gate, (req, res) => send(res, store.start(req.params.code, str(req.body && req.body.token))));
  app.post('/api/strike/rooms/:code/roll', gate, (req, res) => send(res, store.roll(req.params.code, str(req.body && req.body.token), req.body && req.body.rolls)));
  app.post('/api/strike/rooms/:code/rematch', gate, (req, res) => send(res, store.rematch(req.params.code, str(req.body && req.body.token))));
  app.post('/api/strike/rooms/:code/leave', gate, (req, res) => send(res, store.leave(req.params.code, str(req.body && req.body.token))));
  return store;
}

module.exports = { registerStrikeRoutes, createStore, readCard, cleanName, FRAMES, AWAY_MS };
