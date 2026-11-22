// Rhythm Rush songs live in two places that must match exactly: the game draws
// from frontend/lib/rhythmSongs.json and the server replays runs against
// games-backend/lib/rhythmSongs.json. Run this after changing either:
//   node scripts/check-rhythm-songs.mjs
// It also checks that every song has the same notes, holds and perfect score,
// which is what lets all songs share one leaderboard.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const a = readFileSync(new URL("../frontend/lib/rhythmSongs.json", import.meta.url), "utf8");
const b = readFileSync(new URL("../games-backend/lib/rhythmSongs.json", import.meta.url), "utf8");
let bad = 0;
const fail = (m) => { console.error("FAIL " + m); bad++; };
if (a !== b) fail("the two rhythmSongs.json files differ. Copy one over the other.");
const S = JSON.parse(a);
const R = require("../games-backend/lib/rhythmScoring.js");
const shape = { T1: 5, T2: 5, T3: 8, T4: 3 };
let ref = null;
for (const song of S.songs) {
  for (const [k, n] of Object.entries(shape)) if (song[k].length !== n) fail(`${song.id}.${k} must have ${n} notes`);
  for (const n of [...song.T1, ...song.T2, ...song.T3, ...song.T4, song.outro]) {
    if (!(n in S.pitches)) fail(`${song.id}: unknown pitch ${n}`);
    if (!(n in song.lanes)) fail(`${song.id}: pitch ${n} has no lane`);
    else if (![0, 1, 2, 3].includes(song.lanes[n])) fail(`${song.id}: lane for ${n} must be 0..3`);
  }
  const chart = R.buildMainChart(song.id);
  const log = [];
  for (const n of chart) { log.push({ lane: n.lane, time: n.time }); if (n.hold) log.push({ lane: n.lane, time: n.time + n.hold, up: 1 }); }
  const perfect = R.computeScore(log, 46000, song.id).score;
  const sig = `${chart.length} notes, ${chart.filter((n) => n.hold).length} holds, perfect ${perfect}`;
  if (ref && sig !== ref) fail(`${song.id} differs from the first song: ${sig} vs ${ref}`);
  ref ??= sig;
  console.log(`${song.id.padEnd(10)} ${sig}`);
}
if (!S.songs.some((s) => s.id === S.default)) fail("default song is missing");
console.log(bad ? `\n${bad} problem(s)` : "\nAll songs match and are fair to each other.");
process.exit(bad ? 1 : 0);
