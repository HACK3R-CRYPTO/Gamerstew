// ─── bootstrap ────────────────────────────────────────────────────────────────
// One domain of the GameArena backend, cut out of the old single server.js
// without changing a statement. Each block below is a part; server.js runs the
// parts of every file in their original order. A name another file uses is
// published on `core` (see the defineProperties at the top of a part) and read
// as `core.name`. New work goes in src/ (TypeScript); this file shrinks as its
// routes move there.

module.exports = [
// ── (top of file) ──
function* (core) {
  Object.defineProperties(core, {
    config: { get: () => config, enumerable: true, configurable: true },
    app: { get: () => app, enumerable: true, configurable: true },
    express: { get: () => express, enumerable: true, configurable: true },
    ipKeyGenerator: { get: () => ipKeyGenerator, enumerable: true, configurable: true },
    rateLimit: { get: () => rateLimit, enumerable: true, configurable: true },
    createClient: { get: () => createClient, enumerable: true, configurable: true },
    crypto: { get: () => crypto, enumerable: true, configurable: true },
    ethers: { get: () => ethers, enumerable: true, configurable: true },
    platform: { get: () => platform, enumerable: true, configurable: true },
    rhythmPhysicsCheck: { get: () => rhythmPhysicsCheck, enumerable: true, configurable: true },
    rhythmIsKnownSong: { get: () => rhythmIsKnownSong, enumerable: true, configurable: true },
    rhythmComputeScore: { get: () => rhythmComputeScore, enumerable: true, configurable: true },
    rhythmJitterCheck: { get: () => rhythmJitterCheck, enumerable: true, configurable: true },
    computeStackScore: { get: () => computeStackScore, enumerable: true, configurable: true },
    computeStackHumanness: { get: () => computeStackHumanness, enumerable: true, configurable: true },
    computeSimonScore: { get: () => computeSimonScore, enumerable: true, configurable: true },
    computeNepaScore: { get: () => computeNepaScore, enumerable: true, configurable: true },
    computeNepaHumanness: { get: () => computeNepaHumanness, enumerable: true, configurable: true },
    metrics: { get: () => metrics, enumerable: true, configurable: true },
    PORT: { get: () => PORT, enumerable: true, configurable: true },
  });
  yield; // every part's shared names exist before any part runs

require('dotenv').config();
// New code is TypeScript under src/, compiled to dist/. Compile now if a deploy
// skipped the build step, so the server can never start without it.
require('../scripts/ensure-build').ensureBuild();
const platform = require('../dist');
const express = require('express');
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const crypto = require('crypto');
const {
  physicsCheck:  rhythmPhysicsCheck,
  jitterCheck:   rhythmJitterCheck,
  computeScore:  rhythmComputeScore,
  isKnownSong:   rhythmIsKnownSong,
} = require('../lib/rhythmScoring');
const { computeStackScore, computeStackHumanness } = require('../lib/stackScoring');
const { computeSimonScore } = require('../lib/simonScoring');
const { computeNepaScore, computeNepaHumanness } = require('../lib/nepaScoring');

const app = express();
// Settings are read once, checked and typed. A bad value stops the boot here
// with a message naming it, not later inside a request.
const config = platform.loadConfig();
for (const w of config.warnings) console.warn(`⚠️  config: ${w}`);
const PORT = config.port;
// Time every request, per route. Mounted first so it measures everything.
const metrics = platform.createMetrics({ slowMs: config.slowRequestMs, timeoutMs: config.requestTimeoutMs });
app.use(metrics.middleware);
// From here on, every route registered is guarded: a handler that throws or
// rejects reaches the error handler instead of leaving the request unanswered.
platform.catchAsync(app);
// Request ids, security headers, and /healthz (answers before the origin gate).
platform.hardenApp(app, { isStopping: () => !!core.lifecycle && core.lifecycle.isStopping() });
// Any route with :address or :wallet in its path refuses a value that is not a wallet.
platform.guardWalletParams(app);
// Timed jobs: one run at a time, failures logged by name, status in /internal/metrics.
core.jobs = platform.createJobs();

// Trust Railway/Vercel reverse proxy so rate-limiter reads X-Forwarded-For correctly
app.set('trust proxy', 1);
},

];
