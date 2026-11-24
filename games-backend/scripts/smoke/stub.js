// A fake Supabase (PostgREST), JSON-RPC node and subgraph, all on one port.
// Deterministic: the same request always gets the same answer.
const http = require('http');
const W = (n) => '0x' + String(n).padStart(40, 'a');
const rows = {
  users: [{ wallet_address: W(1), xp: 120, play_streak: 3, last_played: '2026-11-20', username: 'ada', created_at: '2026-10-01T00:00:00Z' }],
  scores: [{ id: 1, wallet_address: W(1), game: 'rhythm', score: 500, season_number: 1, created_at: '2026-11-20T10:00:00Z', tx_hash: '0x' + 'b'.repeat(64) }],
  activity: [{ wallet_address: W(1), game: 'rhythm', score: 500, game_time: 60000, created_at: '2026-11-20T10:00:00Z', tx_hash: '0x' + 'b'.repeat(64) }],
  seasons: [{ season_number: 1, start_ts: 1770249600, end_ts: 1770854400, prize_pot: 50, sealed: true, created_at: '2026-02-12T00:00:00Z' }],
  badges: [{ wallet_address: W(1), game: 'rhythm', season_number: 1, badge: 'gold' }],
};
const log = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/__log') return send(200, log);
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.slice(9);
      log.push(`${req.method} ${table} ${[...url.searchParams.keys()].sort().join(',')}`);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(201, []);
      const data = rows[table] || [];
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      if (single) return data.length ? send(200, data[0]) : send(406, { code: 'PGRST116', message: 'no rows', details: '', hint: '' });
      return send(200, data, { 'content-range': `0-${Math.max(0, data.length - 1)}/${data.length}` });
    }
    if (url.pathname === '/subgraph') { log.push('subgraph'); return send(200, { data: { scores: [], players: [], globalStat: null, globalStats: [] } }); }
    // JSON-RPC: chain id only; everything else is an error, so no contract call "succeeds"
    try {
      const j = JSON.parse(body || '{}');
      const one = (q) => (q.method === 'eth_chainId' ? { jsonrpc: '2.0', id: q.id, result: '0xa4ec' } : q.method === 'net_version' ? { jsonrpc: '2.0', id: q.id, result: '42220' } : q.method === 'eth_blockNumber' ? { jsonrpc: '2.0', id: q.id, result: '0x1' } : { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'stub' } });
      return send(200, Array.isArray(j) ? j.map(one) : one(j));
    } catch { return send(200, {}); }
  });
}).listen(Number(process.argv[2]), '127.0.0.1', () => console.log('stub up'));
