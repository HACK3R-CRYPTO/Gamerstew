import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missedDays, playToday, standing, MAX_COVER } from './streak';

test('missed days: none for today or yesterday, then one less than the gap', () => {
  assert.deepEqual(['2026-11-26', '2026-11-25', '2026-11-24', '2026-11-20', null].map((d) => missedDays(d, '2026-11-26')), [0, 0, 1, 5, 0]);
  assert.equal(missedDays('2026-10-31', '2026-11-02'), 1, 'across a month end');
});

test('a play: first day, same day, the next day, and a missed day with and without a freeze', () => {
  const t = '2026-11-26';
  assert.deepEqual(playToday({ streak: 0, lastPlay: null, today: t, freezes: 0 }), { streak: 1, use: 0, change: 'first' });
  assert.deepEqual(playToday({ streak: 7, lastPlay: t, today: t, freezes: 2 }), { streak: 7, use: 0, change: 'same' });
  assert.deepEqual(playToday({ streak: 7, lastPlay: '2026-11-25', today: t, freezes: 2 }), { streak: 8, use: 0, change: 'grew' }, 'no freeze is spent when none is needed');
  assert.deepEqual(playToday({ streak: 7, lastPlay: '2026-11-24', today: t, freezes: 0 }), { streak: 1, use: 0, change: 'reset' });
  assert.deepEqual(playToday({ streak: 7, lastPlay: '2026-11-24', today: t, freezes: 1 }), { streak: 8, use: 1, change: 'saved' });
  assert.deepEqual(playToday({ streak: 7, lastPlay: '2026-11-23', today: t, freezes: 2 }), { streak: 8, use: 2, change: 'saved' }, 'two days missed cost two');
});

test('a freeze covers a slip, not a holiday, and is never spent when it would not be enough', () => {
  const t = '2026-11-26';
  assert.equal(MAX_COVER, 2);
  assert.deepEqual(playToday({ streak: 30, lastPlay: '2026-11-22', today: t, freezes: 9 }), { streak: 1, use: 0, change: 'reset' }, 'three days missed is past what can be covered');
  assert.deepEqual(playToday({ streak: 30, lastPlay: '2026-11-23', today: t, freezes: 1 }), { streak: 1, use: 0, change: 'reset' }, 'one freeze for two missed days: none spent, streak gone');
  assert.deepEqual(playToday({ streak: 0, lastPlay: '2026-11-24', today: t, freezes: 2 }), { streak: 1, use: 0, change: 'reset' }, 'there is no streak to save');
});

test('how a streak stands before today is played: alive, at risk, frozen or gone', () => {
  const t = '2026-11-26';
  assert.deepEqual(standing({ streak: 5, lastPlay: t, today: t, freezes: 0 }), { streak: 5, playedToday: true, atRisk: false, frozen: false });
  assert.deepEqual(standing({ streak: 5, lastPlay: '2026-11-25', today: t, freezes: 0 }), { streak: 5, playedToday: false, atRisk: true, frozen: false });
  assert.deepEqual(standing({ streak: 5, lastPlay: '2026-11-24', today: t, freezes: 1 }), { streak: 5, playedToday: false, atRisk: true, frozen: true }, 'a missed day, held by a freeze until they play');
  assert.deepEqual(standing({ streak: 5, lastPlay: '2026-11-24', today: t, freezes: 0 }), { streak: 0, playedToday: false, atRisk: false, frozen: false });
  assert.deepEqual(standing({ streak: 0, lastPlay: null, today: t, freezes: 2 }), { streak: 0, playedToday: false, atRisk: false, frozen: false });
});
