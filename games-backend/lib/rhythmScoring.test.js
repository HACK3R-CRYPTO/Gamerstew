// Rhythm Rush scoring is what the weekly leaderboard pays out on, so these
// tests pin the things that must never change by accident.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const R = require('./rhythmScoring');
const SONGS = require('./rhythmSongs.json');

const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const perfectLog = (chart) => {
  const log = [];
  for (const n of chart) {
    log.push({ lane: n.lane, time: n.time });
    if (n.hold) log.push({ lane: n.lane, time: n.time + n.hold, up: 1 });
  }
  return log;
};

test('the original song is byte-for-byte what it was before songs existed', () => {
  // Hash of the chart built by the pre-songs code. Older game builds send no
  // songId and must be scored against exactly this chart.
  const ORIGINAL = '9338871b167975b5f67b14511c1a0e585065823222a0d1473a55960b19bfc144';
  assert.strictEqual(sha(R.buildMainChart()), ORIGINAL);
  assert.strictEqual(sha(R.buildMainChart(null)), ORIGINAL);
  assert.strictEqual(sha(R.buildMainChart('turca')), ORIGINAL);
});

test('every song has the same notes, holds and perfect score', () => {
  const seen = new Set();
  for (const song of SONGS.songs) {
    const chart = R.buildMainChart(song.id);
    const perfect = R.computeScore(perfectLog(chart), 46000, song.id).score;
    seen.add(`${chart.length}|${chart.filter((n) => n.hold).length}|${perfect}`);
    for (const n of chart) assert.ok([0, 1, 2, 3].includes(n.lane), `${song.id} has a note with no valid lane`);
  }
  assert.strictEqual(seen.size, 1, 'songs must be fair to each other: ' + [...seen].join(' vs '));
});

test('a perfect run on one song does not score as perfect on another', () => {
  const a = R.buildMainChart('turca');
  const own = R.computeScore(perfectLog(a), 46000, 'turca').score;
  for (const song of SONGS.songs.filter((s) => s.id !== 'turca')) {
    assert.ok(R.computeScore(perfectLog(a), 46000, song.id).score < own, `turca taps should not max out ${song.id}`);
  }
});

test('only real song ids are known', () => {
  for (const song of SONGS.songs) assert.ok(R.isKnownSong(song.id));
  for (const bad of ['nope', '', '__proto__', 'constructor', 'toString', undefined, null, 5, {}, []]) {
    assert.strictEqual(R.isKnownSong(bad), false, `${String(bad)} must not be a known song`);
  }
});

test('an unknown song id falls back to the original chart instead of crashing', () => {
  assert.strictEqual(sha(R.buildMainChart('__proto__')), sha(R.buildMainChart()));
  assert.strictEqual(sha(R.buildMainChart({})), sha(R.buildMainChart()));
});
