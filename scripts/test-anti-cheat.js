// Anti-cheat verification script.
//
// Runs every documented attack path against the patched /api/sign-score and
// confirms each one is rejected with the expected error. If the script ends
// with "ALL ATTACKS BLOCKED" the patch is working as designed.
//
// Usage:
//   INTERNAL_SECRET=<your-secret> WALLET=0x... \
//     node scripts/test-anti-cheat.js
//
// INTERNAL_SECRET comes from Railway env vars (Variables tab).
// WALLET should be a test wallet you've used to play.

const https = require('https');

const BACKEND = 'https://game-backend-production-6130.up.railway.app';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const WALLET = process.env.WALLET;

if (!INTERNAL_SECRET || !WALLET) {
  console.error('Usage: INTERNAL_SECRET=... WALLET=0x... node scripts/test-anti-cheat.js');
  process.exit(1);
}

function post(path, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(`${BACKEND}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-internal-secret': INTERNAL_SECRET,
        'Content-Length':    Buffer.byteLength(data),
      },
    }, (res) => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function header(s) {
  console.log('\n' + '─'.repeat(60));
  console.log(`  ${s}`);
  console.log('─'.repeat(60));
}

function pass(label, response, expectedSubstring) {
  const text = JSON.stringify(response);
  const matched = text.includes(expectedSubstring);
  console.log(`  ${matched ? '✅ BLOCKED' : '❌ LEAKED'}  ${label}`);
  console.log(`    → ${text.slice(0, 120)}`);
  return matched;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let failures = 0;

  header('Attack 1: Direct sign-score with no session (the PoC)');
  {
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
    });
    if (!pass('No sessionToken → reject', r, 'Missing sessionToken')) failures++;
  }

  header('Attack 2: Fake sessionToken');
  {
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
      sessionToken: 'fakefakefakefakefakefakefakefake',
      tapLog: [],
    });
    if (!pass('Invalid sessionToken → reject', r, 'Invalid session token')) failures++;
  }

  header('Attack 3: Real session + no tapLog');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    if (!start.body.success) {
      console.log('  ❌ Could not start session, aborting:', start.body);
      failures++;
    } else {
      console.log('  Session token issued:', start.body.sessionToken.slice(0, 16) + '...');
      const r = await post('/api/sign-score', {
        playerAddress: WALLET,
        game:  'rhythm',
        score: 999999,
        sessionToken: start.body.sessionToken,
        // no tapLog
      });
      if (!pass('Missing tapLog → reject', r, 'Missing tapLog')) failures++;
    }
  }

  header('Attack 4: Real session + empty tapLog');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    await sleep(5500); // satisfy min duration
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
      sessionToken: start.body.sessionToken,
      tapLog: [],
    });
    if (!pass('Empty tap log → reject', r, 'No taps recorded')) failures++;
  }

  header('Attack 5: Submit immediately (under min duration)');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    // No wait — submit < 5s after start
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
      sessionToken: start.body.sessionToken,
      tapLog: [{ lane: 0, time: 1.0 }, { lane: 1, time: 1.5 }],
    });
    if (!pass('Session too short → reject', r, 'Session too short')) failures++;
  }

  header('Attack 6: Taps too fast for human (sub-30ms gaps)');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    await sleep(5500);
    // 50 taps with 5ms gaps — impossible for a human
    const taps = [];
    for (let i = 0; i < 50; i++) taps.push({ lane: i % 4, time: 5.0 + i * 0.005 });
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
      sessionToken: start.body.sessionToken,
      tapLog: taps,
    });
    if (!pass('Sub-30ms tap gap → reject', r, 'Taps too fast')) failures++;
  }

  header('Attack 7: Constructed perfect tap log (matches all chart notes)');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    await sleep(5500);
    // Build the same chart the server uses, then submit taps at the EXACT
    // perfect time for every note. This passes physics but should fail jitter.
    const { buildMainChart } = require('../games-backend/lib/rhythmScoring');
    const chart = buildMainChart();
    const taps = chart.map(n => ({ lane: n.lane, time: n.time }));
    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,
      sessionToken: start.body.sessionToken,
      tapLog: taps,
    });
    if (!pass('Synthetic perfect timing → reject', r, 'Inhuman timing')) failures++;
  }

  header('Attack 8: Same session token used twice (replay)');
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    await sleep(5500);
    const { buildMainChart } = require('../games-backend/lib/rhythmScoring');
    const chart = buildMainChart();
    // Use realistic human-like jitter so the first call passes
    const taps = chart.map(n => ({
      lane: n.lane,
      time: n.time + (Math.random() - 0.5) * 0.08,
    }));
    const firstCall = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 0,
      sessionToken: start.body.sessionToken,
      tapLog: taps,
    });
    console.log(`  First call result: ${JSON.stringify(firstCall.body).slice(0, 80)}`);

    // Now try to reuse the same token
    const replay = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 0,
      sessionToken: start.body.sessionToken,
      tapLog: taps,
    });
    if (!pass('Reused sessionToken → reject', replay, 'Session already used')) failures++;
  }

  header('Attack 9: Full PoC chain with session — claim 999999 with realistic jittered taps');
  // This is the most important test. The cheater does EVERYTHING the
  // researcher's PoC did, plus the new session step, plus realistic jitter
  // to bypass the timing checks. They claim score 999999. The server runs
  // its own replay using the same scoring rules and returns whatever the
  // math actually produces from those inputs — NOT the claimed number.
  {
    const start = await post('/api/start-game', { wallet: WALLET, game: 'rhythm' });
    console.log('  Session token issued:', start.body.sessionToken.slice(0, 16) + '...');
    await sleep(5500);

    const { buildMainChart } = require('../games-backend/lib/rhythmScoring');
    const chart = buildMainChart();
    // Human-like jitter: ±60ms random offset on each tap. Passes physics
    // and jitter checks, mimics a real player's timing distribution.
    const taps = chart.map(n => ({
      lane: n.lane,
      time: n.time + (Math.random() - 0.5) * 0.12,
    }));

    console.log(`  Claiming score: 999999`);
    console.log(`  Sending ${taps.length} realistic-jittered taps`);

    const r = await post('/api/sign-score', {
      playerAddress: WALLET,
      game:  'rhythm',
      score: 999999,             // ← cheater's claim
      sessionToken: start.body.sessionToken,
      tapLog: taps,
    });

    if (r.body.success) {
      const serverScore = r.body.score;
      console.log(`  Server computed: ${serverScore}`);
      if (serverScore < 999999) {
        console.log(`  ✅ NEUTRALIZED  Cheater claimed 999999, server returned ${serverScore}`);
        console.log(`    → That's the score the EIP-712 voucher will sign.`);
        console.log(`    → On-chain submission with claim=999999 + sig=${serverScore} would REVERT (contract verifies sig matches score).`);
      } else {
        console.log('  ❌ LEAKED  Server returned the claimed value');
        failures++;
      }
    } else {
      console.log(`  Server rejected entirely: ${JSON.stringify(r.body)}`);
      console.log(`  ✅ BLOCKED  (rejection is even stronger than score correction)`);
    }
  }

  header('SUMMARY');
  if (failures === 0) {
    console.log('  ✅ ALL ATTACKS BLOCKED — patch is working as designed.');
  } else {
    console.log(`  ❌ ${failures} attack(s) leaked. Review the output above.`);
    process.exit(1);
  }
})().catch(err => {
  console.error('Script error:', err);
  process.exit(1);
});
