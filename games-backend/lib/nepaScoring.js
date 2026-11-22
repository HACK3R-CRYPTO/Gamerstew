// ─── nepaScoring.js ──────────────────────────────────────────────────────────
// Server-side replica of "NEPA: Up Light" (gameType 4) scoring. Used by
// /api/sign-score in SHADOW MODE only: the computed score is logged next to the
// client's claimed score, but the CLIENT'S score is still what gets signed.
// Read games-backend/ANTICHEAT.md before wiring this into enforcement.
//
// WHY this is deterministic and device-independent:
//
// Every run is driven by a per-session `seed` issued by /api/start-game and
// stored on the game_sessions row (the client can't choose it). The seed fully
// determines the LIGHT-CUT schedule (when NEPA takes the light). The client
// records a discrete input log — every plug/unplug/bank the player committed to,
// with the millisecond offset at which it happened. Given {seed, inputLog} this
// function replays the run EXACTLY: it does not re-simulate animation frames or
// read wall-clock timestamps for timing decisions beyond the offsets the client
// already committed to, so a phone that drops frames scores identically to a
// fast one (same trap Stack's replica avoids).
//
// The frontend ports this same logic (frontend/app/games/nepa/page.tsx) so the
// SUBMITTED score is itself a replay of the client's own input log — that makes
// client and server points equal by construction, so shadow deltas should be
// ~0 for honest runs.
//
// This is Step 1 of ANTICHEAT.md's rollout (recompute the score from an input
// log). computeNepaHumanness is Step 2 (tap cadence/placement), logged only.
// Enforcement comes later, once real-run parity is confirmed.

// ─── Config · MUST mirror frontend/app/games/nepa/page.tsx ───────────────────
// If the client changes any of these, update this file too or shadow deltas
// drift and (once enforced) real players get rejected.
const DEFAULTS = {
  sessionMs:     40_000, // 40s session
  sockets:       3,      // start with 3 sockets (v1)
  nairaPerPoint: 1_000,  // ₦1,000 banked = 1 on-chain point (score bound ≤ 1e6)
};

// Device roster. value = ₦ banked on a full charge; chargeMs = seconds of
// LIGHT-ON time needed to fill. Keys are the device ids the client logs.
// This roster MUST stay identical to the client table in
// frontend/app/games/nepa/page.tsx — any device the client can plug must
// exist here, or the replay silently drops it and the shadow-mode delta is
// corrupted (the parity telemetry we use to decide when to enforce).
const DEVICES = {
  phone:     { value: 8_000,  chargeMs: 2_000 },
  powerbank: { value: 12_000, chargeMs: 3_000 },
  lamp:      { value: 10_000, chargeMs: 2_500 },
  fan:       { value: 15_000, chargeMs: 4_000 },
  pump:      { value: 25_000, chargeMs: 5_000 },
  inverter:  { value: 30_000, chargeMs: 6_000 },
  fridge:    { value: 40_000, chargeMs: 8_000 },
};

const SCORE_SUBMIT_MIN = 0;
const SCORE_SUBMIT_MAX = 1_000_000; // on-chain score bound · points, not naira

// Combo multiplier applied to a device's banked value. combo is the count of
// consecutive successful banks (no early unplug in between). combo 1 → ×1.00,
// each further bank adds 0.15, capped at combo 7 → ×1.90. An early unplug
// resets combo to 0.
function comboMult(combo) {
  return 1 + 0.15 * Math.min(Math.max(combo - 1, 0), 6);
}

// ─── Deterministic PRNG · mulberry32 seeded via xmur3 ────────────────────────
// Pure integer arithmetic → byte-identical in Node and the browser. MUST stay
// identical to the frontend port.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function nepaRand(seed) {
  const seedFn = xmur3(String(seed));
  return mulberry32(seedFn());
}

// ─── Light schedule · pure function of the seed ──────────────────────────────
// Alternating ON/OUT windows across the whole session, starting ON ("UP NEPA!").
// ON windows shrink from ~6s to ~2.5s as the session burns down; OUT windows
// are ~1.2s–3.0s and erratic. Returns [{ on, start, end }] covering [0, totalMs].
function nepaLightSchedule(seed, totalMs) {
  const rand = nepaRand(String(seed) + '|light');
  const segs = [];
  let t = 0;
  let on = true;
  // Hard cap the loop so a pathological config can never spin forever.
  for (let guard = 0; guard < 1000 && t < totalMs; guard++) {
    let dur;
    if (on) {
      const frac = t / totalMs;                 // 0 → 1 across the session
      const base = 6000 - frac * 3500;          // 6000ms → 2500ms
      dur = base + (rand() - 0.5) * 1500;       // ±750ms jitter
      if (dur < 2000) dur = 2000;
    } else {
      dur = 1200 + rand() * 1800;               // 1200ms → 3000ms
    }
    dur = Math.round(dur);
    const end = Math.min(totalMs, t + dur);
    segs.push({ on, start: t, end });
    t = end;
    on = !on;
  }
  return segs;
}

// Walk the schedule from startT, accumulating charge time until `needMs` is
// reached; return the wall-clock ms at which the charge completes, or Infinity
// if the session ends first.
//
// A millisecond counts toward charge if the LIGHT is ON, OR it falls inside the
// optional gen window (the GENERATOR power-up keeps a device charging THROUGH a
// light cut for [genWindow.start, genWindow.end)). genWindow is {start,end}|null;
// when null/absent this behaves exactly as the original ON-only accrual, so
// nothing that does not pass a gen window changes.
function chargeCompleteTime(segs, startT, needMs, totalMs, genWindow) {
  let remaining = needMs;
  const gw = genWindow && typeof genWindow.start === 'number' ? genWindow : null;
  for (const seg of segs) {
    if (seg.end <= startT) continue;
    const segStart = Math.max(seg.start, startT);
    if (segStart >= totalMs) break;
    if (seg.on) {
      // Light ON → the whole segment charges.
      const avail = seg.end - segStart;
      if (avail >= remaining) return segStart + remaining;
      remaining -= avail;
    } else if (gw) {
      // Light OUT → only the slice overlapping the gen window charges.
      const lo = Math.max(segStart, gw.start);
      const hi = Math.min(seg.end, gw.end);
      if (hi > lo) {
        const avail = hi - lo;
        if (avail >= remaining) return lo + remaining;
        remaining -= avail;
      }
    }
    // light OUT with no gen cover → no charge progress
  }
  return Infinity;
}

// ─── Chaos events · pure function of the seed (SEPARATE PRNG stream) ──────────
// Draws from an independent "<seed>:events" stream so adding/removing these
// never shifts the light schedule. All four windows are derived, never logged,
// so they cannot be forged — the replay re-derives them identically on both the
// client and the server. Windows may overlap, and their multipliers stack.
//   · doubleMoney — one ~5s window where every bank earns ×2.
//   · golden      — the rare "ac" (freezer) device: ₦80,000 / 7s, pluggable
//                   ONLY inside an ~8s availability window.
//   · rat         — a rat chews one socket for ~4s: an occupied socket is fried
//                   (wasted) when the window opens, and it can't be plugged then.
//   · frenzy      — the final 10s: every bank earns ×1.5.
// Draw order is fixed (dm.start, golden.start, rat.start, rat.socket) so both
// copies land on identical values.
function nepaEvents(seed, totalMs) {
  const rng = mulberry32(xmur3(String(seed) + ':events')());
  const dmStart = 8000 + Math.floor(rng() * 12000);
  const doubleMoney = { start: dmStart, end: dmStart + 5000 };
  const gStart = 10000 + Math.floor(rng() * 15000);
  const golden = { device: 'ac', value: 80000, chargeMs: 7000, start: gStart, end: gStart + 8000 };
  const rStart = 13000 + Math.floor(rng() * 13000);
  const ratSocket = Math.floor(rng() * 3);
  const rat = { start: rStart, end: rStart + 4000, socket: ratSocket };
  const frenzy = { start: totalMs - 10000, mult: 1.5 };
  return { doubleMoney, golden, rat, frenzy };
}

// ─── computeNepaScore · PURE function ────────────────────────────────────────
// Input: { seed, inputLog, config }
//   · seed     : the per-session seed string issued by /api/start-game
//   · inputLog : ordered-ish array of { device, socket, action:'plug'|'unplug'|'bank', t }
//                (t = ms since run start). Sorted here defensively.
//   · config   : optional overrides for DEFAULTS
// Output: { nairaScore, points, banked, wasted, maxCombo }
//   · nairaScore : total ₦ banked (display value)
//   · points     : floor(nairaScore / nairaPerPoint), clamped to [0, 1e6] · on-chain
//   · banked     : count of devices the player grabbed while full
//   · wasted     : count of early unplugs (banked nothing, reset combo)
//   · maxCombo   : longest successful-bank streak
//
// TAP-TO-GRAB replay model (no auto-bank):
//   · PLUG  occupies a free socket. An invalid plug (unknown device, out-of-
//     range socket, or socket already busy) is ignored.
//   · A device charges only during LIGHT-ON windows; chargeCompleteTime gives
//     bankT, the earliest wall-clock ms at which it is FULL. Reaching full does
//     NOT auto-credit — the device sits in the socket, READY, until the player
//     acts.
//   · BANK  credits a socket ONLY IF, at the logged t, that socket still holds
//     that device AND t >= bankT (the device is actually full). On credit:
//     combo++, gain = round(value · comboMult(combo)), socket freed. A bank that
//     is early (t < bankT), on an empty socket, or device-mismatched is IGNORED
//     entirely (no credit, no state change) — this t>=bankT test is the anti-
//     cheat guard: a tampered client cannot grab before the seed says it is full.
//     Banking is allowed anytime a device is full, INCLUDING during a light cut
//     (collecting a finished charge needs no power; only charging needs light).
//   · UNPLUG a still-charging device (t < bankT) wastes it: combo=0, wasted++,
//     socket freed. Unplugging a full device just frees the socket uncredited.
//   · SESSION END: any socket still occupied is forfeit — unbanked devices are
//     lost, whether still charging or sitting full. There is no end-of-game
//     sweep. The player must bank before time runs out.
// Combo only advances on a valid bank and only resets on an early unplug;
// letting a full device sit does not break the combo.
function computeNepaScore({ seed, inputLog, config } = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (!Array.isArray(inputLog)) {
    return { nairaScore: 0, points: 0, banked: 0, wasted: 0, maxCombo: 0 };
  }

  const segs = nepaLightSchedule(seed, cfg.sessionMs);
  // Chaos events for this seed, computed once. The golden device is added to a
  // LOCAL roster (charge/value lookups only) — it is never a permanent device.
  const ev = nepaEvents(seed, cfg.sessionMs);
  const roster = { ...DEVICES, ac: { value: ev.golden.value, chargeMs: ev.golden.chargeMs } };

  const events = inputLog
    .filter(e => e && (e.action === 'plug' || e.action === 'unplug' || e.action === 'bank' || e.action === 'gen') &&
                 typeof e.t === 'number' && isFinite(e.t))
    .slice()
    .sort((a, b) => a.t - b.t);

  const sockets = new Array(cfg.sockets).fill(null); // { device, value, plugT, bankT }
  let nairaScore = 0;
  let combo = 0;
  let banked = 0;
  let wasted = 0;
  let maxCombo = 0;
  let genWindow = null;   // set by the FIRST 'gen' action → [tg, tg+6000]
  let ratApplied = false; // the rat fries its socket exactly once

  for (const e of events) {
    const t = Math.max(0, Math.min(cfg.sessionMs, e.t));

    // RAT · one-time injection at the FIRST event whose time crosses rat.start.
    // Whatever sits in the rat socket at that instant is fried (waste + combo
    // reset); the current event is then handled normally — so a bank aimed at
    // that socket now finds it empty and credits nothing (the rat won the race).
    if (!ratApplied && t >= ev.rat.start) {
      ratApplied = true;
      if (sockets[ev.rat.socket]) { combo = 0; wasted += 1; sockets[ev.rat.socket] = null; }
    }

    const sock = e.socket;
    const sockOk = typeof sock === 'number' && sock >= 0 && sock < sockets.length;

    if (e.action === 'gen') {
      // GENERATOR · the FIRST pop opens a 6s window where OUT segments still
      // charge. Later gen actions are ignored. Re-derive bankT for everything
      // currently in a socket so a device mid-charge benefits from the window.
      if (genWindow === null) {
        genWindow = { start: t, end: t + 6000 };
        for (let s = 0; s < sockets.length; s++) {
          const occ = sockets[s];
          if (occ) {
            const dev = roster[occ.device];
            if (dev) occ.bankT = chargeCompleteTime(segs, occ.plugT, dev.chargeMs, cfg.sessionMs, genWindow);
          }
        }
      }
      continue;
    }

    if (e.action === 'plug') {
      const dev = roster[e.device];
      if (!dev) continue;
      if (!sockOk) continue;
      if (sockets[sock]) continue; // socket busy → invalid plug ignored
      // GOLDEN · "ac" is pluggable ONLY inside its availability window; a plug
      // outside it is rejected (no socket change).
      if (e.device === 'ac' && !(t >= ev.golden.start && t < ev.golden.end)) continue;
      // RAT · the rat socket cannot be plugged while the rat owns it.
      if (sock === ev.rat.socket && t >= ev.rat.start && t < ev.rat.end) continue;
      const bankT = chargeCompleteTime(segs, t, dev.chargeMs, cfg.sessionMs, genWindow);
      sockets[sock] = { device: e.device, value: dev.value, plugT: t, bankT };
    } else if (e.action === 'bank') {
      if (!sockOk) continue;
      const occ = sockets[sock];
      // Credit ONLY IF the socket still holds that device AND it is actually
      // full (t >= bankT). Anything else is ignored with no state change.
      if (occ && occ.device === e.device && t >= occ.bankT) {
        combo += 1;
        if (combo > maxCombo) maxCombo = combo;
        // Multipliers STACK: combo × double-money (×2) × frenzy (×1.5).
        let gain = occ.value * comboMult(combo);
        if (t >= ev.doubleMoney.start && t < ev.doubleMoney.end) gain *= 2;
        if (t >= ev.frenzy.start) gain *= ev.frenzy.mult;
        nairaScore += Math.round(gain);
        banked += 1;
        sockets[sock] = null;
      }
    } else { // unplug
      if (!sockOk) continue;
      const occ = sockets[sock];
      if (occ && occ.device === e.device) {
        // An EARLY unplug (device not yet full) is a waste and breaks combo.
        // Unplugging a full device just frees the socket uncredited.
        if (t < occ.bankT) { combo = 0; wasted += 1; }
        sockets[sock] = null;
      }
    }
  }

  // RAT fallback · if no event ever crossed rat.start, a device could still be
  // parked in the rat socket — fry it before the session-end forfeit so it
  // counts as wasted, not merely lost.
  if (!ratApplied && sockets[ev.rat.socket]) {
    combo = 0; wasted += 1; sockets[ev.rat.socket] = null;
  }

  // Session end: no sweep. Any device still in a socket is forfeit.

  const points = Math.min(
    SCORE_SUBMIT_MAX,
    Math.max(SCORE_SUBMIT_MIN, Math.floor(nairaScore / cfg.nairaPerPoint)),
  );
  return { nairaScore, points, banked, wasted, maxCombo };
}

// ─── Humanness check (ANTICHEAT.md Step 2) ───────────────────────────────────
// Recomputing the score stops "submit any number"; this guards the forged log.
// SHADOW-FIRST: loose thresholds that never flag a real player on day one.
// Returns { human, reasons, stats } · `human:false` is a FLAG for review, not
// (yet) a rejection.
//   1. RATE · inputs per second from the log's own offsets. A human taps a
//      handful of times a second at most; a dumped log shows up instantly.
//   2. SOCKET SANITY · plugs can never exceed banks + wastes + still-charging,
//      and the log should never address a socket outside [0, sockets).
const HUMAN_MAX_INPUTS_PER_SEC = 10; // generous · real frantic play is ~1-4/s
const HUMAN_MIN_INPUTS_FOR_RATE = 8; // need a few inputs before rate means anything

function computeNepaHumanness(inputLog, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const reasons = [];
  if (!Array.isArray(inputLog) || inputLog.length === 0) {
    return { human: true, reasons: [], stats: { inputs: 0 } };
  }

  const ts = inputLog
    .map(e => (e && typeof e.t === 'number' && isFinite(e.t) ? e.t : null))
    .filter(t => t !== null);

  // 1) Rate
  let inputsPerSec = 0;
  if (ts.length >= HUMAN_MIN_INPUTS_FOR_RATE) {
    let lo = ts[0], hi = ts[0];
    for (const t of ts) { if (t < lo) lo = t; if (t > hi) hi = t; }
    const span = hi - lo;
    const spanSec = Math.max(0.001, span / 1000);
    inputsPerSec = inputLog.length / spanSec;
    if (inputsPerSec > HUMAN_MAX_INPUTS_PER_SEC) {
      reasons.push(`rate ${inputsPerSec.toFixed(1)}/s > ${HUMAN_MAX_INPUTS_PER_SEC}/s`);
    }
  }

  // 2) Socket sanity · any socket index outside range is a forged/garbage log.
  let badSockets = 0;
  for (const e of inputLog) {
    // 'gen' is a socket-less power-up action — it carries no socket ref, so it
    // is not subject to the socket-range check.
    if (e && e.action === 'gen') continue;
    const s = e && e.socket;
    if (typeof s !== 'number' || s < 0 || s >= cfg.sockets) badSockets += 1;
  }
  if (badSockets > 0) reasons.push(`${badSockets} out-of-range socket refs`);

  return {
    human: reasons.length === 0,
    reasons,
    stats: {
      inputs: inputLog.length,
      inputsPerSec: Math.round(inputsPerSec * 10) / 10,
      badSockets,
    },
  };
}

module.exports = {
  DEFAULTS,
  DEVICES,
  comboMult,
  nepaRand,
  nepaLightSchedule,
  nepaEvents,
  chargeCompleteTime,
  computeNepaScore,
  computeNepaHumanness,
};
