// The outbox against a real (local) chain and the real GamePass contract.
// Proves the parts unit tests cannot: real ethers errors are classified right,
// a dropped transaction is detected, nothing is recorded twice.
const { spawn } = require('child_process');
const R = require('path').resolve(__dirname, '../../..');
const { ethers } = require(R + '/games-backend/node_modules/ethers');
const { createOutbox, RESEND_AFTER_MS } = require(R + '/games-backend/dist/modules/outbox/service.js');
const { ethersOutboxChain } = require(R + '/games-backend/dist/modules/outbox/adapters.js');
const { createBatchSender } = require(R + '/games-backend/dist/modules/outbox/sender.js');
setTimeout(() => { console.log('TIMED OUT'); process.exit(2); }, 150000).unref();
const art = require(R + '/contracts/out/GamePass.sol/GamePass.json');
const PORT = 8599; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'];

function memStore(clock) {
  const rows = []; let seq = 0;
  return { rows, store: {
    async enqueue(r) { const had = rows.find((x) => x.session_token === r.sessionToken); if (had) return { ok: true, id: had.id, created: false }; rows.push({ id: ++seq, session_token: r.sessionToken, wallet: r.wallet, game: r.game, game_type: r.gameType, score: r.score, status: 'pending', attempts: 0, tx_hash: null, sent_at: null, due: clock.t }); return { ok: true, id: seq, created: true }; },
    async claim(limit, lease) { const due = rows.filter((x) => x.status === 'pending' && x.due <= clock.t).slice(0, limit); for (const x of due) { x.due = clock.t + lease; x.attempts++; } return due.map((x) => ({ ...x })); },
    async markSent(id, h) { const x = rows.find((r) => r.id === id); x.status = 'sent'; x.tx_hash = h; x.sent_at = new Date(clock.t).toISOString(); },
    async markConfirmed(id) { rows.find((r) => r.id === id).status = 'confirmed'; },
    async markFailed(id, why) { const x = rows.find((r) => r.id === id); x.status = 'failed'; x.last_error = why; },
    async retryLater(id, d, why) { const x = rows.find((r) => r.id === id); x.status = 'pending'; x.tx_hash = null; x.due = clock.t + d; x.last_error = why; },
    async sentUnconfirmed(older, limit) { return rows.filter((x) => x.status === 'sent' && clock.t - Date.parse(x.sent_at) >= older).slice(0, limit).map((x) => ({ ...x })); },
    async counts() { const n = (s) => rows.filter((x) => x.status === s).length; return { pending: n('pending'), sent: n('sent'), confirmed: n('confirmed'), failed: n('failed'), oldestPendingMs: null }; },
  } };
}

(async () => {
  const anvil = spawn(process.env.HOME + '/.aztec/current/bin/anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  let failed = 0; const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };
  try {
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, undefined, { cacheTimeout: -1 });
    for (let i = 0; i < 50; i++) { try { await provider.getBlockNumber(); break; } catch { await sleep(100); } }
    const [validator, p1, p2] = KEYS.map((k) => new ethers.Wallet(k, provider));
    const pass = await (await new ethers.ContractFactory(art.abi, art.bytecode.object, validator).deploy()).waitForDeployment();
    await (await pass.connect(p1).mint('playerone')).wait();
    const writer = pass.connect(validator);
    // the same shape as the live backend: one sender, submissions one after another
    let chainQ = Promise.resolve();
    const submitScore = (w, g, s) => { const run = chainQ.then(() => writer.recordScore(w, g, s)); chainQ = run.then(() => {}, () => {}); return run; };
    const clock = { t: Date.now() };
    // the fast sender, wired as on the live server: same wallet, same single write lane
    const serialize = (fn) => { const run = chainQ.then(fn); chainQ = run.then(() => {}, () => {}); return run; };
    const sender = createBatchSender({ provider: () => provider, signer: () => validator, contract: await pass.getAddress(), encode: (w, g, sc) => pass.interface.encodeFunctionData('recordScore', [w, g, sc]), hasPass: (w) => pass.hasMinted(w), serialize });
    const FAST = process.argv.includes('--slow') ? undefined : (rows) => sender.submitMany(rows);
    const mk = () => { const m = memStore(clock); return { ...m, box: createOutbox({ store: m.store, chain: ethersOutboxChain({ provider: () => provider, submitScore, submitMany: FAST }), now: () => clock.t, logger: { log() {}, warn() {} } }) }; };
    console.log(FAST ? 'sender: one call a score (batch)' : 'sender: the old way (one at a time)');
    const games = async () => Number((await pass.queryFilter(pass.filters.ScoreRecorded(p1.address))).length);

    // 1 · happy path
    { const w = mk(); for (let i = 1; i <= 3; i++) await w.box.enqueue({ sessionToken: 'a' + i, wallet: p1.address, game: 'stack', gameType: 2, score: 10 * i });
      const s = await w.box.sendDue(); clock.t += 10_000; const c = await w.box.confirmSent();
      check('three scores go out and confirm', s.sent === 3 && c.confirmed === 3 && w.rows.every((r) => r.status === 'confirmed'));
      check('the chain has them: best 30, three records', Number(await pass.bestScore(p1.address, 2)) === 30 && (await games()) === 3); }

    // 2 · a player with no GamePass: the real revert must be read as permanent
    { const w = mk(); await w.box.enqueue({ sessionToken: 'b1', wallet: p2.address, game: 'stack', gameType: 2, score: 5 });
      const s = await w.box.sendDue();
      check('no GamePass is marked failed at once, not retried', s.failed === 1 && s.retried === 0 && w.rows[0].status === 'failed', `(chain said: ${String(w.rows[0].last_error).slice(0, 70)})`); }

    // 3 · the sending wallet runs dry
    { const w = mk(); const before = await provider.getBalance(validator.address);
      await provider.send('anvil_setBalance', [validator.address, '0x0']);
      for (let i = 1; i <= 4; i++) await w.box.enqueue({ sessionToken: 'c' + i, wallet: p1.address, game: 'simon', gameType: 1, score: i });
      const s = await w.box.sendDue();
      check('out of gas pauses the queue and fails nothing', s.stopped === true && s.failed === 0 && w.rows.every((r) => r.status === 'pending') && (await w.box.status()).outOfGas === true, `(chain said: ${String(w.rows[0].last_error)})`);
      await provider.send('anvil_setBalance', [validator.address, ethers.toBeHex(before)]);
      clock.t += 2 * 60_000; const s2 = await w.box.sendDue(); clock.t += 10_000; const c = await w.box.confirmSent();
      check('after a top-up every waiting score goes out', s2.sent === 4 && c.confirmed === 4 && (await w.box.status()).outOfGas === false); }

    // 4 · a transaction that is dropped before it is mined
    { const w = mk(); const start = await games();
      await provider.send('evm_setAutomine', [false]);
      await w.box.enqueue({ sessionToken: 'd1', wallet: p1.address, game: 'rhythm', gameType: 0, score: 777 });
      await w.box.sendDue(); const hash = w.rows[0].tx_hash;
      clock.t += RESEND_AFTER_MS + 60_000;
      const waiting = await w.box.confirmSent(); const resentEarly = await w.box.sendDue();
      check('sent but not mined: left alone, not sent again', waiting.waiting === 1 && waiting.resend === 0 && resentEarly.sent === 0);
      await provider.send('anvil_dropTransaction', [hash]);
      const dropped = await w.box.confirmSent();
      check('the chain has no trace of it: queued to go again', dropped.resend === 1 && w.rows[0].status === 'pending');
      const again = await w.box.sendDue();
      await provider.send('evm_setAutomine', [true]); await provider.send('evm_mine', []);
      clock.t += 10_000; const c = await w.box.confirmSent();
      check('it goes out again, confirms, and is on-chain exactly once', again.sent === 1 && c.confirmed === 1 && (await games()) === start + 1 && Number(await pass.bestScore(p1.address, 0)) === 777); }

    // 5 · how fast one sender can go on a chain with no network delay
    { const w = mk(); const N = 60; for (let i = 0; i < N; i++) await w.box.enqueue({ sessionToken: 'e' + i, wallet: p1.address, game: 'stack', gameType: 2, score: 1 });
      const calls = []; const orig = provider.send.bind(provider); provider.send = (m, p) => { calls.push(m); return orig(m, p); };
      const t0 = Date.now(); let sent = 0; while (sent < N) { const r = await w.box.sendDue(); sent += r.sent; if (!r.sent) break; }
      const ms = Date.now() - t0; provider.send = orig;
      console.log(`      network calls for ${N} scores: ${calls.length} (${(calls.length / N).toFixed(1)} a score) · sends ${calls.filter((c) => c === 'eth_sendRawTransaction').length}`);
      await provider.send('evm_mine', []); clock.t += 10_000; let conf = 0; for (let k = 0; k < 4; k++) conf += (await w.box.confirmSent()).confirmed;
      check('and all sixty confirm on-chain', conf === N, `(${conf} confirmed)`);
      check(`sixty scores sent`, sent === N, `in ${ms} ms = ${(ms / N).toFixed(1)} ms each with zero network delay`); }
  } catch (e) { console.log('ERROR', e.shortMessage || e.message); failed++; }
  finally { anvil.kill(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
})();
