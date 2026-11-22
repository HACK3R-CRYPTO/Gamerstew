const test = require('node:test');
const assert = require('node:assert');
const {
  DEVICES, comboMult, nepaLightSchedule, nepaEvents, chargeCompleteTime,
  computeNepaScore, computeNepaHumanness, DEFAULTS,
} = require('./nepaScoring');

const SEED = 'nepa-test-seed-0001';

// Known schedule for SEED (pure function of the seed):
//   ON  0 – 5442   → a phone (2s) fills at 2000, a pump (5s) fills at 5000
//   OUT 5442 – 7502
// These anchors let the bank-timing tests pick t's that are deterministically
// before/after full and inside/outside a light cut.

// Helpers · build a plug / unplug / bank event.
const plug   = (device, socket, t) => ({ device, socket, action: 'plug',   t });
const unplug = (device, socket, t) => ({ device, socket, action: 'unplug', t });
const bank   = (device, socket, t) => ({ device, socket, action: 'bank',   t });
const gen    = (t) => ({ action: 'gen', t });

// Chaos-event anchors for SEED (pure function of the seed · see nepaEvents):
//   doubleMoney [14282, 19282)   golden "ac" [11460, 19460) · ₦80,000 / 7s
//   rat [16273, 20273) socket 2  frenzy start 30000 · ×1.5
// These let the chaos tests pick deterministic banks inside/outside each window.

// ── Determinism · the whole fairness story rests on this ─────────────────────
test('same seed + same input log → identical score every time', () => {
  const log = [plug('phone', 0, 100), bank('phone', 0, 3000), plug('lamp', 1, 200), bank('lamp', 1, 4000)];
  const a = computeNepaScore({ seed: SEED, inputLog: log });
  const b = computeNepaScore({ seed: SEED, inputLog: log });
  assert.deepEqual(a, b);
});

test('the light schedule is a pure function of the seed', () => {
  const s1 = nepaLightSchedule(SEED, DEFAULTS.sessionMs);
  const s2 = nepaLightSchedule(SEED, DEFAULTS.sessionMs);
  assert.deepEqual(s1, s2);
  const other = nepaLightSchedule('a-different-seed', DEFAULTS.sessionMs);
  assert.notDeepEqual(s1, other);
});

test('the session always opens with the light ON (UP NEPA!)', () => {
  const segs = nepaLightSchedule(SEED, DEFAULTS.sessionMs);
  assert.equal(segs[0].on, true);
  assert.equal(segs[0].start, 0);
});

test('the schedule tiles the whole session with no gaps', () => {
  const segs = nepaLightSchedule(SEED, DEFAULTS.sessionMs);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[segs.length - 1].end, DEFAULTS.sessionMs);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, segs[i - 1].end);
});

// ── Core TAP-TO-GRAB scoring ──────────────────────────────────────────────────
test('a full device the player banks credits its value', () => {
  // Plug a phone at t=0 (fills at 2000), then BANK it at 2500 — fully charged.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0), bank('phone', 0, 2500)] });
  assert.equal(out.banked, 1);
  assert.equal(out.wasted, 0);
  // combo 1 → ×1.00 → exactly the device value.
  assert.equal(out.nairaScore, DEVICES.phone.value);
  assert.equal(out.points, Math.floor(DEVICES.phone.value / DEFAULTS.nairaPerPoint));
});

test('a plug with no bank banks nothing (no auto-bank)', () => {
  // Phone fills at 2000 but the player never taps to grab it → forfeit at end.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0)] });
  assert.equal(out.banked, 0);
  assert.equal(out.nairaScore, 0);
});

test('(1) a bank before the device is full is NOT credited (and does not consume it)', () => {
  // Bank at 1000 (phone not full until 2000) → ignored, device stays put; a
  // later bank at 2500 (now full) still credits it.
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('phone', 0, 0), bank('phone', 0, 1000), bank('phone', 0, 2500)],
  });
  assert.equal(out.banked, 1);
  assert.equal(out.nairaScore, DEVICES.phone.value);
});

test('(2) a bank after the device is full IS credited', () => {
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('pump', 0, 0), bank('pump', 0, 5200)] });
  assert.equal(out.banked, 1);
  assert.equal(out.nairaScore, DEVICES.pump.value);
});

test('(3) a full device left unbanked at session end earns nothing', () => {
  // Phone fills at 2000 and sits READY for the rest of the run, but is never
  // banked — session end forfeits it.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0)] });
  assert.equal(out.banked, 0);
  assert.equal(out.nairaScore, 0);
});

test('(4) banking a full device DURING a light cut still credits', () => {
  // Phone fills at 2000 (opening ON). First cut is 5442–7502; bank at 6000,
  // mid-blackout. Collecting a finished charge needs no power → it credits.
  const segs = nepaLightSchedule(SEED, DEFAULTS.sessionMs);
  const cut = segs.find(s => !s.on);
  const tInCut = Math.round((cut.start + cut.end) / 2);
  assert.ok(tInCut > 2000, 'bank time must be after the phone is full');
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0), bank('phone', 0, tInCut)] });
  assert.equal(out.banked, 1);
  assert.equal(out.nairaScore, DEVICES.phone.value);
});

test('(5) client/server parity · the same log scores deterministically', () => {
  const log = [
    plug('phone', 0, 0), plug('lamp', 1, 50),
    bank('phone', 0, 2500), bank('lamp', 1, 3000),
    plug('fan', 0, 3100), bank('fan', 0, 10000),
  ];
  const a = computeNepaScore({ seed: SEED, inputLog: log });
  const b = computeNepaScore({ seed: SEED, inputLog: log.slice() });
  assert.deepEqual(a, b);
  assert.equal(a.banked, 3);
});

test('combo multiplier is applied across consecutive banks', () => {
  // Two phones fill at 2000; bank both → combo 1 (×1.00) then combo 2 (×1.15).
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('phone', 0, 0), plug('phone', 1, 0), bank('phone', 0, 2500), bank('phone', 1, 2600)],
  });
  assert.equal(out.banked, 2);
  assert.equal(out.maxCombo, 2);
  const expected = Math.round(DEVICES.phone.value * comboMult(1)) + Math.round(DEVICES.phone.value * comboMult(2));
  assert.equal(out.nairaScore, expected);
});

test('an early unplug banks nothing and resets combo', () => {
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('fridge', 0, 0), unplug('fridge', 0, 500)], // 8s charge, pulled at 0.5s
  });
  assert.equal(out.banked, 0);
  assert.equal(out.wasted, 1);
  assert.equal(out.nairaScore, 0);
});

test('an empty / non-array input log scores zero cleanly', () => {
  assert.deepEqual(
    computeNepaScore({ seed: SEED, inputLog: [] }),
    { nairaScore: 0, points: 0, banked: 0, wasted: 0, maxCombo: 0 },
  );
  assert.equal(computeNepaScore({ seed: SEED, inputLog: null }).nairaScore, 0);
});

test('a plug onto a busy socket is ignored (no stacking in one slot)', () => {
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('phone', 0, 0), plug('fridge', 0, 10), bank('phone', 0, 2500)], // fridge dropped, phone banks
  });
  assert.equal(out.banked, 1);
  assert.equal(out.nairaScore, DEVICES.phone.value); // only the phone banked
});

test('an out-of-range socket index is ignored', () => {
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 9, 0), bank('phone', 9, 2500)] });
  assert.equal(out.banked, 0);
  assert.equal(out.nairaScore, 0);
});

test('an unknown device id is ignored', () => {
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('generator', 0, 0), bank('generator', 0, 2500)] });
  assert.equal(out.banked, 0);
});

test('combo multiplier grows with consecutive banks, capped at ×1.90', () => {
  assert.equal(comboMult(1), 1);
  assert.ok(Math.abs(comboMult(2) - 1.15) < 1e-9);
  assert.ok(Math.abs(comboMult(7) - 1.90) < 1e-9);
  assert.ok(Math.abs(comboMult(50) - 1.90) < 1e-9); // stays capped
});

test('a device still charging at session end banks nothing', () => {
  // Plug a fridge (8s) very near the end — it can never fill, and a bank at the
  // end is ignored because the device is not full.
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('fridge', 0, DEFAULTS.sessionMs - 1000), bank('fridge', 0, DEFAULTS.sessionMs - 1)],
  });
  assert.equal(out.banked, 0);
  assert.equal(out.nairaScore, 0);
});

test('chargeCompleteTime pauses while the light is OUT', () => {
  // A schedule: ON 0-1000, OUT 1000-3000, ON 3000-10000.
  const segs = [
    { on: true,  start: 0,    end: 1000 },
    { on: false, start: 1000, end: 3000 },
    { on: true,  start: 3000, end: 10000 },
  ];
  // Need 2000ms of ON time starting at t=0: 1000ms before the cut, then it
  // resumes at 3000 and needs 1000ms more → completes at 4000, not 2000.
  assert.equal(chargeCompleteTime(segs, 0, 2000, 10000), 4000);
});

test('on-chain points never exceed the 1,000,000 bound', () => {
  // A dense-but-legal stream of plug→bank cycles across the session.
  const log = [];
  for (let s = 0; s < DEFAULTS.sockets; s++) {
    for (let t = 0; t + 6000 < DEFAULTS.sessionMs; t += 6000) {
      log.push(plug('phone', s, t));
      log.push(bank('phone', s, t + 5500));
    }
  }
  const out = computeNepaScore({ seed: SEED, inputLog: log });
  assert.ok(out.points <= 1_000_000);
  assert.ok(out.points >= 0);
});

// ── Humanness (shadow) ───────────────────────────────────────────────────────
test('a normal-paced log reads as human', () => {
  const log = [plug('phone', 0, 0), plug('lamp', 1, 400), bank('lamp', 1, 3000), unplug('fan', 1, 3200)];
  assert.equal(computeNepaHumanness(log).human, true);
});

test('a machine-gun input flood is flagged (not rejected) on rate', () => {
  const log = Array.from({ length: 200 }, (_, i) => bank('phone', i % 3, i)); // 200 inputs in ~0.2s
  const h = computeNepaHumanness(log);
  assert.equal(h.human, false);
  assert.ok(h.reasons.some(r => r.includes('rate')));
});

test('out-of-range socket refs are flagged', () => {
  const log = [plug('phone', 99, 0), bank('phone', 0, 100)];
  const h = computeNepaHumanness(log);
  assert.equal(h.human, false);
  assert.ok(h.reasons.some(r => r.includes('socket')));
});

// ── Roster parity · must mirror the client table exactly ─────────────────────
// Regression guard: a device the client can plug but the server doesn't know
// gets silently dropped by the replay, corrupting the shadow-mode delta.
test('server roster carries every device the client can plug', () => {
  const clientDevices = ['phone', 'powerbank', 'lamp', 'fan', 'pump', 'inverter', 'fridge'];
  for (const id of clientDevices) {
    assert.ok(DEVICES[id], `backend DEVICES missing "${id}" — must mirror the client`);
  }
  assert.equal(Object.keys(DEVICES).length, clientDevices.length, 'roster size drifted from the client');
});

test('a pumping-machine charge actually banks (not dropped by the replay)', () => {
  // Plug the pump at t=0 during the opening ON window; it fills in 5s of light,
  // then the player banks it.
  const log = [plug('pump', 0, 0), bank('pump', 0, 5200)];
  const r = computeNepaScore({ seed: SEED, inputLog: log });
  assert.ok(r.nairaScore >= 25_000, `pump should bank ₦25,000+, got ₦${r.nairaScore}`);
});

// ── Chaos / fun mechanics · all SEED-driven, mirrored in the frontend replay ──
// doubleMoney [14282,19282) · golden "ac" [11460,19460) · rat [16273,20273) s2 ·
// frenzy @30000. The same phone (fills at 2000) is banked inside vs outside each
// window so only the multiplier differs.
test('nepaEvents is deterministic and uses a stream separate from the light', () => {
  const a = nepaEvents(SEED, DEFAULTS.sessionMs);
  const b = nepaEvents(SEED, DEFAULTS.sessionMs);
  assert.deepEqual(a, b);
  // Frenzy is always the final 10s of the session.
  assert.equal(a.frenzy.start, DEFAULTS.sessionMs - 10_000);
  assert.ok(Math.abs(a.frenzy.mult - 1.5) < 1e-9);
  // The golden device roster entry is the ₦80,000 / 7s freezer.
  assert.equal(a.golden.device, 'ac');
  assert.equal(a.golden.value, 80_000);
  assert.equal(a.golden.chargeMs, 7_000);
  // A different seed shifts the windows (separate stream, not the light one).
  const other = nepaEvents('a-different-seed', DEFAULTS.sessionMs);
  assert.notDeepEqual(a.doubleMoney, other.doubleMoney);
});

test('DOUBLE MONEY · a bank inside the window earns ×2 vs the same bank outside', () => {
  const inside  = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0), bank('phone', 0, 15_000)] });
  const outside = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0), bank('phone', 0, 3_000)] });
  assert.equal(outside.nairaScore, DEVICES.phone.value);          // ×1
  assert.equal(inside.nairaScore, DEVICES.phone.value * 2);       // ×2
});

test('FRENZY · a bank in the last 10s earns ×1.5', () => {
  // Bank at 31000 (≥ frenzy.start 30000, well past double-money) → ×1.5.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 0, 0), bank('phone', 0, 31_000)] });
  assert.equal(out.nairaScore, Math.round(DEVICES.phone.value * 1.5));
});

test('STACKING · a bank inside double-money AND frenzy earns ×3', () => {
  // Shrink the session to 25s so frenzy.start (15000) lands inside double-money
  // [14282,19282). A bank at 16000 is in BOTH → ×2 × ×1.5 = ×3 on combo 1.
  const out = computeNepaScore({
    seed: SEED, config: { sessionMs: 25_000 },
    inputLog: [plug('phone', 0, 0), bank('phone', 0, 16_000)],
  });
  assert.equal(out.nairaScore, DEVICES.phone.value * 3);
});

test('GOLDEN · "ac" plugged inside its window banks ₦80,000; outside it is ignored', () => {
  // Plug the freezer at golden.start (11460); it fills at 23145, banked at 24000.
  const inside = computeNepaScore({ seed: SEED, inputLog: [plug('ac', 0, 11_460), bank('ac', 0, 24_000)] });
  assert.equal(inside.banked, 1);
  assert.equal(inside.nairaScore, 80_000);           // combo 1, no other window
  // Plug "ac" at 5000 (before the window opens) → rejected, nothing to bank.
  const outside = computeNepaScore({ seed: SEED, inputLog: [plug('ac', 0, 5_000), bank('ac', 0, 24_000)] });
  assert.equal(outside.banked, 0);
  assert.equal(outside.nairaScore, 0);
});

test('RAT · a device charging in the rat socket when rat.start passes is fried', () => {
  // Phone in socket 2 (the rat socket) fills at 17000; the bank at 18000 is the
  // first event ≥ rat.start (16273), so the rat fries the socket FIRST and the
  // bank finds it empty. Wasted, not credited.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 2, 15_000), bank('phone', 2, 18_000)] });
  assert.equal(out.banked, 0);
  assert.equal(out.wasted, 1);
  assert.equal(out.nairaScore, 0);
});

test('RAT · a plug to the rat socket during the window is rejected', () => {
  // Plug socket 2 at 17000 (inside [16273,20273)) → rejected; later bank finds
  // nothing to credit.
  const out = computeNepaScore({ seed: SEED, inputLog: [plug('phone', 2, 17_000), bank('phone', 2, 19_500)] });
  assert.equal(out.banked, 0);
  assert.equal(out.nairaScore, 0);
});

test('GENERATOR · a gen window lets a device finish THROUGH a light cut', () => {
  // Power bank (3s) plugged at 4000 straddles the OUT window 5442–7502: without
  // help it only fills at 9060, so a bank at 8000 fails. A gen at 4000 opens
  // [4000,10000] where the OUT slice still charges → it fills at 7000 and banks.
  const noGen = computeNepaScore({ seed: SEED, inputLog: [plug('powerbank', 0, 4_000), bank('powerbank', 0, 8_000)] });
  assert.equal(noGen.banked, 0);
  assert.equal(noGen.nairaScore, 0);

  const withGen = computeNepaScore({ seed: SEED, inputLog: [plug('powerbank', 0, 4_000), gen(4_000), bank('powerbank', 0, 8_000)] });
  assert.equal(withGen.banked, 1);
  assert.equal(withGen.nairaScore, DEVICES.powerbank.value);   // combo 1, no window
});

test('GENERATOR · only the FIRST gen action opens a window (2nd+ ignored)', () => {
  // A second gen later in the run must not open a fresh window. The power bank
  // still relies on the first gen (at 4000) to finish through the 5442 cut.
  const out = computeNepaScore({
    seed: SEED,
    inputLog: [plug('powerbank', 0, 4_000), gen(4_000), gen(20_000), bank('powerbank', 0, 8_000)],
  });
  assert.equal(out.banked, 1);
  assert.equal(out.nairaScore, DEVICES.powerbank.value);
});

test('determinism · a log with chaos events scores identically every time', () => {
  const log = [plug('powerbank', 0, 4_000), gen(4_000), bank('powerbank', 0, 8_000), plug('ac', 1, 11_460), bank('ac', 1, 24_000)];
  const a = computeNepaScore({ seed: SEED, inputLog: log });
  const b = computeNepaScore({ seed: SEED, inputLog: log.slice() });
  assert.deepEqual(a, b);
});

test('a gen action does not trip the humanness socket-sanity check', () => {
  const log = [plug('phone', 0, 0), gen(500), bank('phone', 0, 2_500)];
  const h = computeNepaHumanness(log);
  assert.equal(h.stats.badSockets, 0);
  assert.equal(h.human, true);
});
