// Room stakes against a real (local) chain and a real permit token.
// Proves what unit tests cannot: a real signature is accepted and a forged one
// refused, a loser's entry lands in the winner's wallet, a permit cannot be
// charged twice, and a loser who empties their wallet simply does not pay.
const { spawn } = require('child_process');
const R = require('path').resolve(__dirname, '../../..');
const { ethers } = require(R + '/games-backend/node_modules/ethers');
const { createRoomService } = require(R + '/games-backend/dist/modules/rooms/service.js');
const { tokenStakePay, TOKEN_ABI } = require(R + '/games-backend/dist/modules/rooms/pay.js');
setTimeout(() => { console.log('TIMED OUT'); process.exit(2); }, 150000).unref();
const art = require(R + '/contracts/out/DuelEscrow.t.sol/MockG.json');
const PORT = 8601; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// anvil's well-known test keys: server, treasury, three players, an outsider
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'];
let failed = 0; const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' · ' + extra : ''}`); if (!cond) failed++; };

(async () => {
  const anvil = spawn(process.env.HOME + '/.aztec/current/bin/anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  try {
    await sleep(1800);
    const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, undefined, { cacheTimeout: -1 });
    // plain wallets, as the server uses: each transaction asks the chain for its nonce
    const [server, treasury, ada, bo, cy, out] = KEYS.map((k) => new ethers.Wallet(k, provider));
    const addr = async (w) => (await w.getAddress()).toLowerCase();
    const token = await new ethers.ContractFactory(art.abi, art.bytecode.object, server).deploy(); await token.waitForDeployment();
    const tokenAddress = await token.getAddress(); const chainId = Number((await provider.getNetwork()).chainId);
    const G = (n) => ethers.parseEther(String(n)); const bal = async (w) => Number(ethers.formatEther(await token.balanceOf(await addr(w))));
    for (const w of [ada, bo, cy]) await (await token.mint(await addr(w), G(500))).wait();
    const spender = await addr(server);
    const pay = tokenStakePay({ token: new ethers.Contract(tokenAddress, TOKEN_ABI, server), tokenAddress, tokenName: 'GoodDollar', tokenVersion: '1', chainId, spender, treasury: await addr(treasury) });
    const E100 = G(100).toString();
    const game = { verified: true, deal: () => ({}), maxProgress: 100, score: async (_s, p) => ({ ok: true, score: Number(p.n) }) };
    const svc = createRoomService({ g: game }, { stakes: { pay, feeBps: 1000, entries: [E100], spender } });
    // what a player's wallet does: sign a permit for the server, over its current nonce
    const sign = async (w, value = E100, to = spender) => {
      const owner = await addr(w); const deadline = Math.floor(Date.now() / 1000) + 30 * 60; const nonce = await token.nonces(owner);
      const sig = ethers.Signature.from(await w.signTypedData({ name: 'GoodDollar', version: '1', chainId, verifyingContract: tokenAddress },
        { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, { owner, spender: to, value, nonce, deadline }));
      return { owner, value, deadline, v: sig.v, r: sig.r, s: sig.s };
    };
    const room = async () => { const h = svc.create('g', 'Ada'); const b = svc.join(h.code, 'Bo'); const c = svc.join(h.code, 'Cy'); return { code: h.code, h, b, c }; };

    // 1 · forged and misdirected permits are refused; real ones accepted
    let r = await room();
    const forged = { ...(await sign(out)), owner: await addr(ada) };           // the outsider signs, claiming to be Ada
    check('a permit signed by someone else is refused', (await svc.stake(r.code, r.h.token, E100, forged)).error === 'bad_permit');
    check('a permit made out to another spender is refused', (await svc.stake(r.code, r.h.token, E100, await sign(ada, E100, await addr(out)))).error === 'bad_permit');
    check('a wallet without the entry is refused', (await svc.stake(r.code, r.h.token, E100, await sign(out))).error === 'bad_permit');
    check('the host\'s real permit is accepted', !(await svc.stake(r.code, r.h.token, E100, await sign(ada))).error);
    await svc.commit(r.code, r.b.token, await sign(bo)); const v = await svc.commit(r.code, r.c.token, await sign(cy));
    check('everyone signed: ready', v.stake && v.stake.state === 'ready');
    check('signing moved no money', (await bal(ada)) === 500 && (await bal(bo)) === 500 && (await bal(cy)) === 500);

    // 2 · a round: Bo wins, the others pay him directly, the fee goes to the treasury
    svc.start(r.code, r.h.token);
    await svc.finish(r.code, r.h.token, { n: 10 }); await svc.finish(r.code, r.b.token, { n: 90 }); await svc.finish(r.code, r.c.token, { n: 50 });
    check('settled', (await svc.settle(r.code)) === 'settled');
    check('balances after the round', (await bal(ada)) === 400 && (await bal(bo)) === 680 && (await bal(cy)) === 400 && (await bal(treasury)) === 20, `ada ${await bal(ada)} bo ${await bal(bo)} cy ${await bal(cy)} treasury ${await bal(treasury)}`);
    check('the server wallet holds nothing', (await bal(server)) === 0);
    check('the winner\'s permit was never used: no allowance left behind', (await token.allowance(await addr(bo), spender)) === 0n && (await token.allowance(await addr(ada), spender)) === 0n);
    const view = svc.get(r.code, r.h.token);
    check('each payment has a transaction', view.stake.pays.join() === 'paid,,paid' && /^0x[0-9a-f]{64}$/.test(view.stake.txs[0]));

    // 3 · a used permit cannot take a second entry
    const adaPermit = await sign(ada); // fresh, valid
    const first = await pay.collect(adaPermit, await addr(cy), G(90).toString(), G(10).toString());
    const second = await pay.collect(adaPermit, await addr(cy), G(90).toString(), G(10).toString());
    check('one permit, one entry', first.ok === true && second.ok === false && (await bal(ada)) === 300, `ada ${await bal(ada)}`);
    check('a spent permit no longer passes the check', (await pay.check(adaPermit)).ok === false);

    // 4 · a loser who empties their wallet does not pay; the other loser still does
    r = await room();
    await svc.stake(r.code, r.h.token, E100, await sign(ada)); await svc.commit(r.code, r.b.token, await sign(bo)); await svc.commit(r.code, r.c.token, await sign(cy));
    svc.start(r.code, r.h.token);
    await (await token.connect(ada).transfer(await addr(out), await token.balanceOf(await addr(ada)))).wait(); // Ada moves everything out mid-round
    await svc.finish(r.code, r.h.token, { n: 1 }); await svc.finish(r.code, r.b.token, { n: 9 }); await svc.finish(r.code, r.c.token, { n: 99 });
    const cyBefore = await bal(cy);
    check('settled with one unpaid', (await svc.settle(r.code)) === 'settled' && svc.get(r.code, r.h.token).stake.pays.join() === 'unpaid,paid,');
    check('no allowance is left standing against the dodger', (await token.allowance(await addr(ada), spender)) === 0n);
    check('the honest loser paid, the dodger did not', (await bal(cy)) === cyBefore + 90 && (await bal(ada)) === 0, `cy ${await bal(cy)}`);

    // 5 · a tie moves nothing
    r = await room(); await (await token.mint(await addr(ada), G(500))).wait();
    await svc.stake(r.code, r.h.token, E100, await sign(ada)); await svc.commit(r.code, r.b.token, await sign(bo)); await svc.commit(r.code, r.c.token, await sign(cy));
    const before = [await bal(ada), await bal(bo), await bal(cy)].join();
    svc.start(r.code, r.h.token); for (const s of [r.h, r.b, r.c]) await svc.finish(r.code, s.token, { n: 7 });
    check('a tie is void and moves nothing', (await svc.settle(r.code)) === 'void' && [await bal(ada), await bal(bo), await bal(cy)].join() === before);
  } catch (e) { console.log('ERROR', e.shortMessage || e.message); failed++; } finally { anvil.kill(); }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
})();
