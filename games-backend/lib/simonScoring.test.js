const test = require('node:test');
const assert = require('node:assert');
const { derivePattern, verifySimonRun, earliestClearMs, computeSimonScore } = require('./simonScoring');

// Plays a run the way the game does (frontend/app/games/simon/page.tsx): shows
// each round at the given pace, the player taps it back, the score is fixed
// when a round is cleared. `retries` are rounds the player gets wrong once and
// then repeats. Returns what the phone would send, plus its own score.
function playRun({ token, rounds, pace = 1, tapMs = 250, retries = [], headStart = 0 }) {
  const pattern = derivePattern(token, rounds + 1);
  const taps = []; let t = 0, score = 0;
  for (let r = 1; r <= rounds + 1; r++) {
    const flash = Math.max(200, 500 - (r + headStart) * 30), gap = Math.max(350, 700 - (r + headStart) * 35);
    const show = () => { t += (600 + r * gap + flash) * pace; };
    show();
    if (r === rounds + 1) { taps.push(pattern[0] === 'red' ? 'cyan' : 'red'); t += tapMs; break; } // the miss that ends the run
    if (retries.includes(r)) { taps.push(pattern[0] === 'red' ? 'cyan' : 'red'); t += tapMs + 1500; show(); } // wrong, buys a retry
    for (let j = 0; j < r; j++) { taps.push(pattern[j]); t += tapMs; }
    score = r * 10 + Math.max(0, Math.floor((60000 - t) / 1000)) + r * 2;
    t += 700;
  }
  return { tapLog: taps, clientScore: score, gameMs: t };
}

test('an honest run is never cut: the server bound is at least the score the game showed', () => {
  let n = 0;
  for (const rounds of [0, 1, 2, 3, 5, 8, 12, 20, 35]) for (const pace of [1, 1.4]) for (const tapMs of [120, 400, 900]) for (const headStart of [0, 20]) {
    const run = playRun({ token: `tok-${rounds}-${pace}-${tapMs}`, rounds, pace, tapMs, headStart });
    if (run.gameMs > 11 * 60 * 1000) continue; // longer than a session can be
    const v = verifySimonRun({ sessionToken: `tok-${rounds}-${pace}-${tapMs}`, tapLog: run.tapLog, elapsedMs: run.gameMs + 800 });
    assert.strictEqual(v.rounds, rounds, `rounds for ${rounds}/${pace}/${tapMs}/${headStart}`);
    assert.ok(v.score >= run.clientScore, `cut an honest run: server ${v.score} < client ${run.clientScore} (${rounds} rounds)`);
    n++;
  }
  assert.ok(n > 80);
});

test('a run with bought retries still counts every round it cleared', () => {
  const run = playRun({ token: 'retry', rounds: 9, retries: [4, 7] });
  const v = verifySimonRun({ sessionToken: 'retry', tapLog: run.tapLog, elapsedMs: run.gameMs + 500 });
  assert.strictEqual(v.rounds, 9);
  assert.strictEqual(v.failedAttempts, 3); // two retried misses and the last one
  assert.ok(v.score >= run.clientScore);
  // the old shadow replay stopped at the first miss: this is why it was never safe to enforce
  assert.ok(computeSimonScore({ sessionToken: 'retry', tapLog: run.tapLog, clientElapsedMs: run.gameMs }).roundsVerified < 9);
});

test('taps that do not match the pattern earn nothing', () => {
  const v = verifySimonRun({ sessionToken: 'x', tapLog: Array(200).fill('red'), elapsedMs: 600000 });
  assert.ok(v.rounds <= 2); // a few early rounds can match by luck, never a long run
  assert.strictEqual(verifySimonRun({ sessionToken: 'x', tapLog: [], elapsedMs: 600000 }).score, 0);
  assert.strictEqual(verifySimonRun({ sessionToken: 'x', tapLog: 'junk', elapsedMs: 600000 }).score, 0);
});

test('a perfect tap log is cut to the rounds that fit in the time the server saw', () => {
  // the pattern comes from the ticket, so a cheat can produce perfect taps for 60 rounds
  const pattern = derivePattern('cheat', 60); const taps = [];
  for (let r = 1; r <= 60; r++) for (let j = 0; j < r; j++) taps.push(pattern[j]);
  const v = verifySimonRun({ sessionToken: 'cheat', tapLog: taps, elapsedMs: 30000 }); // "60 rounds in 30 seconds"
  assert.strictEqual(v.tapRounds, 60);
  assert.ok(v.rounds < 12, `only what fits in 30 s counts, got ${v.rounds}`);
  assert.strictEqual(v.fitsTime, false);
  assert.ok(earliestClearMs(v.rounds) <= 30000 && earliestClearMs(v.rounds + 1) > 30000);
});

test('the earliest clear time grows with the square of the rounds', () => {
  assert.strictEqual(earliestClearMs(0), 0);
  assert.strictEqual(earliestClearMs(1), 800 + 350);
  assert.strictEqual(earliestClearMs(10), 8000 + 350 * 55 + 6300);
  assert.ok(earliestClearMs(57) > 11 * 60 * 1000); // no run can pass about 56 rounds in one session
});
