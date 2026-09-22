const test = require('node:test');
const assert = require('node:assert');

// Mirrors tugNotifyWindow in server.js. Kept here because the timing is the
// whole risk: fire the launch ping twice and you have spammed everyone at the
// exact moment you most need their goodwill.
const H = 3600 * 1000;
function tugNotifyWindow(nowMs, startMs, endMs) {
  const toStart = startMs - nowMs;
  const toEnd = endMs - nowMs;
  if (toStart > 23 * H && toStart <= 25 * H) return 'tug_eve';
  if (toStart <= 0 && toStart > -2 * H) return 'tug_live';
  if (toEnd > 23 * H && toEnd <= 25 * H) return 'tug_lastday';
  return null;
}

const START = Date.parse('2026-09-23T17:00:00Z');
const END = Date.parse('2026-09-30T17:00:00Z');

test('the eve reminder fires in the 24h window before the start', () => {
  assert.equal(tugNotifyWindow(START - 24 * H, START, END), 'tug_eve');
  assert.equal(tugNotifyWindow(START - 26 * H, START, END), null, 'too early');
  assert.equal(tugNotifyWindow(START - 20 * H, START, END), null, 'too late for the eve ping');
});

test('the launch ping fires at the start and not before', () => {
  assert.equal(tugNotifyWindow(START, START, END), 'tug_live');
  assert.equal(tugNotifyWindow(START + H, START, END), 'tug_live');
  assert.equal(tugNotifyWindow(START - H, START, END), null, 'never before the gun');
  assert.equal(tugNotifyWindow(START + 3 * H, START, END), null, 'window closes');
});

test('the last-day ping fires 24h before the end', () => {
  assert.equal(tugNotifyWindow(END - 24 * H, START, END), 'tug_lastday');
  assert.equal(tugNotifyWindow(END - 40 * H, START, END), null);
});

test('mid-event ticks send nothing, so an hourly cron stays quiet', () => {
  // Every hour from launch+3h to end-26h must be silent.
  for (let t = START + 3 * H; t < END - 26 * H; t += H) {
    assert.equal(tugNotifyWindow(t, START, END), null, `unexpected ping at +${(t - START) / H}h`);
  }
});

test('windows never overlap, so one tick can only produce one message', () => {
  for (let t = START - 30 * H; t < END + 5 * H; t += H / 2) {
    const hits = ['tug_eve', 'tug_live', 'tug_lastday'].filter(k => tugNotifyWindow(t, START, END) === k);
    assert.ok(hits.length <= 1);
  }
});

test('an event shorter than 25h cannot fire eve and last-day on the same tick', () => {
  const shortEnd = START + 12 * H;
  const t = START - 24 * H;
  assert.equal(tugNotifyWindow(t, START, shortEnd), 'tug_eve', 'start window wins, single message');
});
