const test = require('node:test');
const assert = require('node:assert');
const { createGaslessBudget } = require('./gaslessBudget');

const W = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa';

test('allows writes under the per-wallet cap', () => {
  const b = createGaslessBudget({ perWalletPerDay: 3, globalPerDay: 100 });
  for (let i = 0; i < 3; i++) { assert.equal(b.check(W).ok, true); b.consume(W); }
  assert.deepEqual(b.check(W), { ok: false, reason: 'wallet_gasless_cap' });
});

test('per-wallet cap is case-insensitive (no bypass by changing address casing)', () => {
  const b = createGaslessBudget({ perWalletPerDay: 2, globalPerDay: 100 });
  b.consume(W.toLowerCase());
  b.consume(W.toUpperCase());
  assert.equal(b.check(W).ok, false, 'casing must not create a second bucket');
});

test('global cap stops a sybil fleet that never trips the per-wallet cap', () => {
  const b = createGaslessBudget({ perWalletPerDay: 60, globalPerDay: 5 });
  for (let i = 0; i < 5; i++) {
    const w = `0x${String(i).padStart(40, '0')}`;
    assert.equal(b.check(w).ok, true);
    b.consume(w);
  }
  // A brand-new wallet, well under its own cap, is still refused.
  assert.deepEqual(b.check('0xdeadbeef'), { ok: false, reason: 'global_gasless_cap' });
});

test('both counters reset at UTC midnight', () => {
  let t = Date.parse('2026-09-21T23:59:00Z');
  const b = createGaslessBudget({ perWalletPerDay: 1, globalPerDay: 1, now: () => t });
  b.consume(W);
  assert.equal(b.check(W).ok, false);
  t = Date.parse('2026-09-22T00:00:01Z');
  assert.equal(b.check(W).ok, true, 'new UTC day must clear both counters');
});

test('check() is side-effect free — only consume() spends budget', () => {
  const b = createGaslessBudget({ perWalletPerDay: 1, globalPerDay: 10 });
  b.check(W); b.check(W); b.check(W);
  assert.equal(b.check(W).ok, true, 'checking must not consume');
  b.consume(W);
  assert.equal(b.check(W).ok, false);
});
