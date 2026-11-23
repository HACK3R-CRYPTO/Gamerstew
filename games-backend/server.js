// ─── GameArena backend: entry point ──────────────────────────────────────────
// This file only starts things, in order. The code lives in two places:
//
//   src/      TypeScript, strict, tested. Every module that has been rewritten:
//             the platform layer, the score path, the boards, seasons, rooms.
//   legacy/   the rest of the old single-file server, cut into one file per
//             domain without changing a statement. It shrinks as routes move
//             into src/.
//
// A legacy file exports its parts as generator functions. Each is stepped twice:
// first so every name it shares is published on `core`, then to run its body.
// The parts run in exactly the order the old file ran them, so routes register,
// timers start and the server listens just as before.

const core = {};

// [file in legacy/, which of its parts], in the order they always ran
const ORDER = [
  ['bootstrap', 0],
  ['gate', 0],
  ['data', 0],
  ['vatar', 0],
  ['chain', 0],
  ['seasons', 0],
  ['data', 1],
  ['progression', 0],
  ['data', 2],
  ['seasons', 1],
  ['scores', 0],
  ['seasons', 2],
  ['progression', 1],
  ['habitat', 0],
  ['seasons', 3],
  ['habitat', 1],
  ['seasons', 4],
  ['habitat', 2],
  ['progression', 2],
  ['challenges', 0],
  ['identity', 0],
  ['challenges', 1],
  ['cup', 0],
  ['challenges', 2],
  ['scores', 1],
  ['challenges', 3],
  ['chain', 1],
  ['arena', 0],
  ['vatar', 1],
  ['arena', 1],
  ['faucet', 0],
  ['health', 0],
  ['notifications', 0],
  ['cup', 1],
  ['notifications', 1],
  ['cup', 2],
  ['seasons', 5],
  ['notifications', 2],
  ['tug', 0],
  ['identity', 1],
  ['notifications', 3],
];

const parts = ORDER.map(([file, k]) => require(`./legacy/${file}`)[k](core));
for (const part of parts) part.next(); // publish shared names
for (const part of parts) part.next(); // run

// Every route is registered by now. Last of all: an unknown path gets a JSON
// 404, and any error a route let through gets one logged, non-leaking 500.
core.platform.installErrorHandlers(core.app);
