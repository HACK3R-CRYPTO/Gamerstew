import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parts, verifyRestore, MIN_WIN_SECONDS, START_ALLOWANCE_S, SKILL_ONE_OFF, SKILL_PER_SECOND } from './rules';

test('parts: the same numbers the game shows', () => {
  assert.deepEqual(parts(10, 45, 200), { breakers: 400, speed: 350, skill: 200, total: 950 });
  assert.deepEqual(parts(10, 120, 0), { breakers: 400, speed: 0, skill: 0, total: 400 });
  assert.equal(parts(10, 82.5, 0).speed, 175);
  assert.deepEqual(parts(4, null, 999), { breakers: 160, speed: 0, skill: 0, total: 160 }); // unfinished: breakers only
});

test('an honest win scores from its own numbers', () => {
  const v = verifyRestore({ won: true, restored: 10, timeTaken: 58, skill: 310 }, 62_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.seconds, 58);
  assert.equal(v.total, parts(10, 58, 310).total);
});

test('the server clock wins: a claimed time cannot undercut what really passed', () => {
  // claims 30 s, but the server saw 100 s since the ticket
  const v = verifyRestore({ won: true, restored: 10, timeTaken: 30, skill: 0 }, 100_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.seconds, 100 - START_ALLOWANCE_S);
  assert.equal(v.total, parts(10, 80, 0).total);
});

test('refused: impossible or malformed runs', () => {
  const bad: [unknown, number][] = [
    [null, 60_000],
    [{ won: true, restored: 9, timeTaken: 50, skill: 0 }, 60_000],          // a win without every breaker
    [{ won: false, restored: 10, timeTaken: null, skill: 0 }, 60_000],      // every breaker but "not won"
    [{ won: true, restored: 10, timeTaken: 90, skill: 0 }, 60_000],         // longer than the session
    [{ won: true, restored: 10, timeTaken: MIN_WIN_SECONDS - 4, skill: 0 }, (MIN_WIN_SECONDS - 3) * 1000], // faster than the street
    [{ won: true, restored: 10, timeTaken: NaN, skill: 0 }, 60_000],
    [{ won: true, restored: 10, timeTaken: 50, skill: -5 }, 60_000],
    [{ won: true, restored: 11, timeTaken: 50, skill: 0 }, 60_000],
    [{ won: false, restored: 8, timeTaken: null, skill: 0 }, 6_000],        // eight breakers in six seconds
  ];
  for (const [proof, ms] of bad) assert.equal(verifyRestore(proof, ms).ok, false, JSON.stringify(proof));
});

test('skill is accepted up to what the time allows, not beyond', () => {
  const v = verifyRestore({ won: true, restored: 10, timeTaken: 50, skill: 9_999_999 }, 52_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.parts.skill, SKILL_ONE_OFF + SKILL_PER_SECOND * 50);
  const fair = verifyRestore({ won: true, restored: 10, timeTaken: 50, skill: 900 }, 52_000);
  assert.ok(fair.ok && fair.parts.skill === 900, 'a strong honest skill score is not cut');
});

test('an unfinished run scores its breakers only', () => {
  const v = verifyRestore({ won: false, restored: 6, timeTaken: null, skill: 500 }, 40_000);
  assert.ok(v.ok); if (!v.ok) return;
  assert.equal(v.total, 240);
});
