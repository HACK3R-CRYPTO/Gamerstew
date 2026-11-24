import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEgressMeter } from './egress';

const reply = (body: string, withLength: boolean) => new Response(body, withLength ? { headers: { 'content-length': String(Buffer.byteLength(body)) } } : {});

test('counts what each table and function sends back, costliest first, and passes the reply on untouched', async () => {
  const clock = { t: 0 }; const meter = createEgressMeter({ now: () => clock.t });
  const replies: Record<string, [string, boolean]> = { users: ['x'.repeat(500), true], game_sessions: ['y'.repeat(4000), false], 'rpc/board_window': ['z'.repeat(90), true] };
  const f = meter.wrap((async (input: string) => { const key = Object.keys(replies).find((k) => String(input).includes('/rest/v1/' + k))!; return reply(...replies[key]!); }) as unknown as typeof fetch);
  const a = await f('https://db.example/rest/v1/users?select=wallet_address&limit=5');
  assert.equal((await a.text()).length, 500, 'the caller still gets the whole reply');
  await f('https://db.example/rest/v1/users?select=xp'); await f(new URL('https://db.example/rest/v1/game_sessions?select=*'));
  await f('https://db.example/rest/v1/rpc/board_window');
  await new Promise((r) => setTimeout(r, 5)); // a reply with no declared length is measured as it is read
  clock.t = 3600_000;
  const s = meter.snapshot();
  assert.deepEqual(s.rows.map((r) => [r.what, r.calls, r.bytes, r.biggest]), [['game_sessions', 1, 4000, 4000], ['users', 2, 1000, 500], ['rpc:board_window', 1, 90, 90]]);
  assert.equal(s.totalBytes, 5090); assert.equal(s.totalCalls, 4); assert.equal(s.sinceSec, 3600);
  assert.equal(s.perDayMb, Math.round(5090 * 24 / 1048576 * 10) / 10);
});

test('a broken reply or an odd address never breaks the call being measured', async () => {
  const meter = createEgressMeter();
  const f = meter.wrap((async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
  assert.equal((await f('not a url')).status, 204);
  assert.equal((await f('https://db.example/storage/v1/object/x')).status, 204);
  assert.deepEqual(meter.snapshot().rows.map((r) => r.what).sort(), ['other', 'storage/v1']);
  await assert.rejects(meter.wrap((async () => { throw new Error('down'); }) as unknown as typeof fetch)('https://db.example/rest/v1/users'), /down/);
});
