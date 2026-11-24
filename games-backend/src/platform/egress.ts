// ─── What the database sends back ────────────────────────────────────────────
// Supabase bills for egress: every byte it sends in reply. You cannot cut what
// you cannot see, so this counts the size of each reply, per table (or per
// database function), and answers one question on demand: which reads cost the
// most. It wraps the fetch the Supabase client uses, so nothing else changes.
//
// Sizes are the bytes on the wire when the reply says so (content-length, which
// is the compressed size, and what is billed), and the size of the body
// otherwise. It is per process and resets on a restart.

export interface EgressRow { what: string; calls: number; bytes: number; biggest: number }

export function createEgressMeter(opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const by = new Map<string, { calls: number; bytes: number; biggest: number }>();
  const since = now();
  const MAX_KEYS = 300; // a ceiling, so odd paths cannot grow memory

  /** "users", "rpc:board_window", or the first part of any other path */
  function nameOf(url: string): string {
    try {
      const path = new URL(url).pathname;
      const rest = path.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
      if (rest) return (rest[1] ? 'rpc:' : '') + rest[2];
      return path.split('/').filter(Boolean).slice(0, 2).join('/') || 'other';
    } catch { return 'other'; }
  }
  function add(what: string, bytes: number) {
    let row = by.get(what);
    if (!row) { if (by.size >= MAX_KEYS) return; row = { calls: 0, bytes: 0, biggest: 0 }; by.set(what, row); }
    row.calls++; row.bytes += bytes; if (bytes > row.biggest) row.biggest = bytes;
  }

  /** Wrap a fetch. The reply is passed on untouched; measuring never delays or breaks a call. */
  function wrap(inner: typeof fetch): typeof fetch {
    return async (input, init) => {
      const res = await inner(input, init);
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url: string }).url;
        const what = nameOf(url);
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > 0) add(what, declared);
        else if (res.body) void res.clone().arrayBuffer().then((b) => add(what, b.byteLength), () => add(what, 0));
        else add(what, 0);
      } catch { /* measuring is never worth failing a request for */ }
      return res;
    };
  }

  /** The costliest reads first. */
  function snapshot(top = 25): { sinceSec: number; totalBytes: number; totalCalls: number; perDayMb: number; rows: EgressRow[] } {
    const rows = [...by.entries()].map(([what, r]) => ({ what, ...r })).sort((a, b) => b.bytes - a.bytes);
    const totalBytes = rows.reduce((n, r) => n + r.bytes, 0); const totalCalls = rows.reduce((n, r) => n + r.calls, 0);
    const sinceSec = Math.max(1, Math.round((now() - since) / 1000));
    // what a day at this rate would come to: the number to hold against the plan's allowance
    return { sinceSec, totalBytes, totalCalls, perDayMb: Math.round((totalBytes / sinceSec) * 86400 / 1048576 * 10) / 10, rows: rows.slice(0, top) };
  }
  return { wrap, snapshot };
}
export type EgressMeter = ReturnType<typeof createEgressMeter>;
