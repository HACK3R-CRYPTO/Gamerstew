import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnergy, type EnergyStore } from './service';

const W = '0x' + 'a'.repeat(40);
function world(free = 3) {
  const clock = { t: Date.parse('2026-11-27T10:00:00Z') }; const used = new Map<string, number>(); let bought = 0; let down = false;
  const store: EnergyStore = {
    take: async (_w, day, f) => { if (down) return null; const u = used.get(day) ?? 0; if (u < f) { used.set(day, u + 1); return { ok: true, paid: false, used: u + 1, bought }; } if (bought > 0) { bought--; return { ok: true, paid: true, used: u, bought }; } return { ok: false, paid: false, used: u, bought: 0 }; },
    giveBack: async (_w, day, paid) => { if (paid) bought++; else used.set(day, Math.max(0, (used.get(day) ?? 0) - 1)); },
    state: async (_w, day) => (down ? null : { used: used.get(day) ?? 0, bought }),
    add: async (_w, plays) => (bought += plays),
  };
  return { energy: createEnergy({ store, free, packPlays: 5, now: () => clock.t }), clock, setDown: (v: boolean) => { down = v; } };
}

test('free runs first, then bought ones, then none; a new day gives the free ones back', async () => {
  const w = world(3);
  for (let i = 0; i < 3; i++) assert.deepEqual([(await w.energy.take(W)).ok, (await w.energy.state(W))!.freeLeft], [true, 2 - i]);
  const out = await w.energy.take(W);
  assert.equal(out.ok, false); assert.equal(out.state!.left, 0);
  assert.equal(await w.energy.grant(W), 5);
  const paid = await w.energy.take(W);
  assert.deepEqual([paid.ok, paid.paid, paid.state!.bought, paid.state!.left], [true, true, 4, 4]);
  w.clock.t += 24 * 3600 * 1000;
  const next = (await w.energy.state(W))!;
  assert.deepEqual([next.freeLeft, next.bought, next.left], [3, 4, 7], 'free runs come back, bought ones are kept');
  assert.equal(next.resetsAt, Date.parse('2026-11-29T00:00:00Z'));
  assert.equal((await w.energy.take(W)).paid, false, 'and the free ones are used before the bought ones');
});

test('a run that could not be opened gives its energy back; a broken meter lets the player in', async () => {
  const w = world(1);
  const t = await w.energy.take(W); await w.energy.giveBack(W, t);
  assert.equal((await w.energy.state(W))!.freeLeft, 1);
  w.setDown(true);
  const blind = await w.energy.take(W);
  assert.deepEqual([blind.ok, blind.state], [true, null]);
  assert.equal(await w.energy.state(W), null);
  assert.equal((await w.energy.take('not a wallet')).ok, true);
});
