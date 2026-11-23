import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { checkEnv, describeEnv, envExample, SETTINGS, SETTING_PATTERNS } from './env';

const ROOT = path.join(__dirname, '..', '..');
const KEY = 'ab'.repeat(32);
const ADDR = '0x' + 'ab'.repeat(20);
const good = { ALLOWED_ORIGINS: 'https://a.xyz', INTERNAL_SECRET: 'hunter2-very-secret', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key-value' };

test('a healthy environment has nothing to report', () => {
  assert.deepStrictEqual(checkEnv(good), { problems: [], missing: [], set: 4, secretsSet: 2 });
  assert.deepStrictEqual(checkEnv({ ...good, VALIDATOR_PRIVATE_KEY: `0x${KEY}`, FAUCET_PRIVATE_KEY: KEY, GAME_PASS_ADDRESS: ADDR, TUG_OVER_CAP_RATE: '0.12', GASLESS_SKILL_GAMES: 'FALSE', FAUCET_MAX_PER_DAY: '50', TUG_GAME_TYPES: '0,1,2', CUP_STARTS_AT: '2026-08-07T16:00:00Z', CUP_ENDS_AT: '2026-08-21T16:00:00Z', SLOW_REQUEST_MS: '', SUBGRAPH_URL: '   ' }).problems, []);
});

test('what is required and missing is named', () => {
  assert.deepStrictEqual(checkEnv({}).missing, ['ALLOWED_ORIGINS', 'INTERNAL_SECRET', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  assert.deepStrictEqual(checkEnv({ ...good, INTERNAL_SECRET: '  ' }).missing, ['INTERNAL_SECRET']);
});

test('each kind of malformed value is caught and named', () => {
  const p = (extra: Record<string, string>) => checkEnv({ ...good, ...extra }).problems;
  assert.deepStrictEqual(p({ FAUCET_MAX_PER_DAY: 'fifty' }), ['FAUCET_MAX_PER_DAY="fifty" is not a whole number']);
  assert.deepStrictEqual(p({ FAUCET_MAX_PER_DAY: '5.5' }), ['FAUCET_MAX_PER_DAY="5.5" is not a whole number']);
  assert.deepStrictEqual(p({ TUG_OVER_CAP_RATE: '12%' }), ['TUG_OVER_CAP_RATE="12%" is not a number']);
  assert.deepStrictEqual(p({ FAUCET_REQUIRE_GOODDOLLAR: 'yes' }), ['FAUCET_REQUIRE_GOODDOLLAR="yes" should be "true" or "false"']);
  assert.deepStrictEqual(p({ SOLO_WAGER_ADDRESS: ADDR.slice(0, -1) }), [`SOLO_WAGER_ADDRESS="${ADDR.slice(0, -1)}" is not a 0x address of 40 hex digits`]); // one digit short
  assert.deepStrictEqual(p({ CELO_RPC_URL: 'forno.celo.org' }), ['CELO_RPC_URL="forno.celo.org" is not a URL']);
  assert.deepStrictEqual(p({ SUBGRAPH_URL: 'ftp://x.y' }), ['SUBGRAPH_URL="ftp://x.y" is not an http(s) URL']);
  assert.match(p({ TUG_ENDS_AT: '30th of September' })[0]!, /^TUG_ENDS_AT="30th of September" is not a date/);
  assert.deepStrictEqual(p({ TUG_REFERRAL_PRIZES_G: '500000,,200000' }), ['TUG_REFERRAL_PRIZES_G="500000,,200000" has an empty item in its comma-separated list']);
});

test('a secret is never echoed, even when it is the thing that is wrong', () => {
  const report = checkEnv({ ...good, VALIDATOR_PRIVATE_KEY: 'my-super-secret-not-a-key', AGENT_PLAY_KEY: 'agent-secret-xyz' });
  assert.deepStrictEqual(report.problems, ['VALIDATOR_PRIVATE_KEY is not a 64-hex-digit private key']);
  const everything = JSON.stringify([report, describeEnv({ ...good, VALIDATOR_PRIVATE_KEY: 'my-super-secret-not-a-key', AGENT_PLAY_KEY: 'agent-secret-xyz', VATAR_SECRET: 'vatar-secret-123' })]);
  for (const secret of ['my-super-secret-not-a-key', 'agent-secret-xyz', 'vatar-secret-123', 'hunter2-very-secret', 'anon-key-value']) assert.ok(!everything.includes(secret), `${secret} leaked`);
  // every setting that sounds like a secret is marked as one
  for (const [name, def] of Object.entries(SETTINGS)) if (/KEY$|SECRET|PRIVATE/.test(name) && name !== 'VAPID_PUBLIC_KEY') assert.strictEqual(def.secret, true, `${name} should be marked secret`);
  assert.ok(SETTING_PATTERNS.every((p) => p.setting.secret));
});

test('settings that only make sense together', () => {
  const p = (extra: Record<string, string>) => checkEnv({ ...good, ...extra }).problems;
  assert.deepStrictEqual(p({ VAPID_PUBLIC_KEY: 'pub' }), ['VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set or both be unset (web push needs the pair)']);
  assert.deepStrictEqual(p({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }), []);
  assert.deepStrictEqual(p({ TUG_STARTS_AT: '2026-10-01T00:00:00Z' }), ['TUG_ENDS_AT is not after TUG_STARTS_AT: the event would never run']); // the default end is now before the start
  assert.deepStrictEqual(p({ CUP_STARTS_AT: '2026-08-21T16:00:00Z', CUP_ENDS_AT: '2026-08-21T16:00:00Z' }), ['CUP_ENDS_AT is not after CUP_STARTS_AT: the event would never run']);
  assert.deepStrictEqual(p({ PARTNER_GAMES: 'blockslide:10:Block Slide, square' , PARTNER_KEY_BLOCKSLIDE: 'k' }), ['PARTNER_GAMES lists "square" but PARTNER_KEY_SQUARE is not set: that partner is silently skipped']);
});

test('describeEnv shows values, defaults and nothing secret', () => {
  const d = describeEnv({ ...good, FAUCET_MAX_PER_DAY: '80' });
  assert.strictEqual(d.Server!.INTERNAL_SECRET, 'set');
  assert.strictEqual(d.Chain!.VALIDATOR_PRIVATE_KEY, 'unset');
  assert.strictEqual(d.Faucet!.FAUCET_MAX_PER_DAY, '80');
  assert.strictEqual(d.Faucet!.FAUCET_MAX_PER_IP_DAY, '(default) 5');
  assert.strictEqual(d.Chain!.SOLO_WAGER_ADDRESS, 'unset');
});

// ── the two tests that keep the catalogue honest ────────────────────────────
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') sourceFiles(p, out); }
    else if (/\.(js|ts)$/.test(f.name) && !/\.test\./.test(f.name)) out.push(p);
  }
  return out;
}

test('no code reads a setting that the catalogue does not list', () => {
  const read = new Set<string>();
  for (const file of [...sourceFiles(path.join(ROOT, 'legacy')), ...sourceFiles(path.join(ROOT, 'lib')), ...sourceFiles(path.join(ROOT, 'src')), path.join(ROOT, 'server.js')]) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1]!);
  }
  assert.ok(read.size > 40, 'the scan found the settings');
  const unlisted = [...read].filter((name) => !(name in SETTINGS) && !SETTING_PATTERNS.some((p) => p.test.test(name)) && name !== 'NODE_ENV');
  assert.deepStrictEqual(unlisted, [], 'add these to src/platform/env.ts');
  const unused = Object.keys(SETTINGS).filter((name) => !read.has(name) && !['PORT', 'ALLOWED_ORIGINS', 'SLOW_REQUEST_MS', 'REQUEST_TIMEOUT_MS', 'SHUTDOWN_GRACE_MS', 'DB_TIMEOUT_MS'].includes(name)); // those six are read through loadConfig
  assert.deepStrictEqual(unused, [], 'these are listed but nothing reads them');
});

test('.env.example matches the catalogue (run: npm run env:example)', () => {
  assert.strictEqual(fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'), envExample());
  const text = envExample();
  for (const name of Object.keys(SETTINGS)) assert.ok(text.includes(`${name}=`), name);
  assert.ok(!/=[^\n]*(hunter|secret-)/i.test(text));
});
