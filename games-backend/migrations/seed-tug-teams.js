// One-time seed: write EVERY currently-qualified player's CURRENT team into
// tug_team, so switching on persistence moves nobody. Run AFTER the migration,
// BEFORE the code deploy takes effect (or right after — idempotent, ignores
// wallets already stored). Usage: node migrations/seed-tug-teams.js
require('dotenv').config({ quiet: true });
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const tugEvent = require('../lib/tugEvent');
const subgraph = require('../lib/subgraph');

const p = new ethers.JsonRpcProvider('https://forno.celo.org');
const id = new ethers.Contract('0xC361A6E67822a0EDc17D899227dd9FC50BD62F42',
  ['function isWhitelisted(address) view returns (bool)', 'function getWhitelistedRoot(address) view returns (address)'], p);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const isVerified = (w) => id.isWhitelisted(w);
const identityRootOf = (w) => id.getWhitelistedRoot(w).then((r) => (!r || r === ethers.ZeroAddress ? null : String(r).toLowerCase())).catch(() => null);
const mapLimit = async (i, n, f) => { const o = []; const it = [...i]; await Promise.all(Array.from({ length: n }, async () => { for (;;) { const x = it.shift(); if (x === undefined) return; o.push(await f(x)); } })); return o; };
const referrerMap = async () => new Map();

(async () => {
  const cfg = tugEvent.tugConfig();
  const r = await tugEvent.buildStandings({ subgraph, isVerified, identityRootOf, mapLimit, referrerMap }, cfg, Date.now());
  const rows = r.players.filter((x) => x.counted).map((x) => ({
    wallet: String(x.wallet).toLowerCase(), identity_root: x.identity_root, team: x.team, event_id: cfg.eventId,
  }));
  console.log(`seeding ${rows.length} current players (red ${rows.filter(x => x.team === 'red').length} / blue ${rows.filter(x => x.team === 'blue').length})`);
  const { error } = await sb.from('tug_team').upsert(rows, { onConflict: 'wallet,event_id', ignoreDuplicates: true });
  if (error) return console.log('SEED FAILED:', error.message);
  console.log('seed OK — current teams frozen; new joiners will now fill the smaller side.');
})().catch((e) => console.log('ERR', e.message));
