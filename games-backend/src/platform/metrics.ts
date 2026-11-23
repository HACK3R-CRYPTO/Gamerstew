// ─── Request timing ──────────────────────────────────────────────────────────
// You cannot make a server fast by guessing. This records how long every
// request takes, per route, and answers three questions on demand: which routes
// are slow, how slow at the median and at the tail, and which ones fail.
//
// It is deliberately small: a fixed ring of recent timings per route, no
// dependency, constant memory. It is per process; when the backend runs as
// several instances this is the piece to swap for a real metrics exporter.

import type { NextFunction, Request, Response } from 'express';

const RING = 256; // recent timings kept per route
const MAX_ROUTES = 400; // a hard ceiling, so a scanner hitting random paths cannot grow memory

interface Bucket { ms: Float64Array; n: number; at: number; count: number; errors: number; slow: number }
export interface RouteStats { route: string; count: number; errors: number; slow: number; p50: number; p95: number; max: number }

export function createMetrics(opts: { slowMs: number; timeoutMs?: number; log?: (msg: string) => void; now?: () => number }) {
  const buckets = new Map<string, Bucket>();
  const log = opts.log ?? ((m) => console.warn(m));
  const now = opts.now ?? (() => performance.now());

  function record(route: string, ms: number, status: number) {
    let b = buckets.get(route);
    if (!b) {
      if (buckets.size >= MAX_ROUTES) return;
      b = { ms: new Float64Array(RING), n: 0, at: 0, count: 0, errors: 0, slow: 0 };
      buckets.set(route, b);
    }
    b.ms[b.at] = ms;
    b.at = (b.at + 1) % RING;
    b.n = Math.min(RING, b.n + 1);
    b.count++;
    if (status >= 500) b.errors++;
    if (ms >= opts.slowMs) {
      b.slow++;
      log(`🐢 slow request: ${route} took ${Math.round(ms)} ms (status ${status})`);
    }
  }

  function snapshot(): RouteStats[] {
    const out: RouteStats[] = [];
    for (const [route, b] of buckets) {
      const sorted = Array.from(b.ms.subarray(0, b.n)).sort((x, y) => x - y);
      const pick = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
      out.push({ route, count: b.count, errors: b.errors, slow: b.slow, p50: pick(0.5), p95: pick(0.95), max: Math.round(sorted[sorted.length - 1] ?? 0) });
    }
    return out.sort((a, b) => b.p95 - a.p95);
  }

  /** Express middleware. Mount it first, so it times everything after it. */
  function middleware(req: Request, res: Response, next: NextFunction) {
    const t0 = now();
    // The matched route pattern ("/api/user/:address"), never the raw URL: one
    // bucket per route, not one per wallet. Unmatched requests share a bucket.
    const name = () => {
      const pattern = (req.route as { path?: string } | undefined)?.path;
      return `${req.method} ${pattern ? `${req.baseUrl}${pattern}` : '(unmatched)'}`;
    };
    // A long-lived stream (live match spectating) is not a slow request: its
    // lifetime is the length of the match. Leave it out of the timings.
    const stream = () => String(res.getHeader('content-type') ?? '').includes('text/event-stream');

    // A handler that fails without replying (a rejected promise nobody caught)
    // leaves the player waiting forever. Answer for it, and count it.
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (res.headersSent || stream()) return;
          log(`⏱️  no reply after ${opts.timeoutMs} ms: ${name()}`);
          res.status(504).json({ error: 'timeout' });
        }, opts.timeoutMs)
      : null;
    timer?.unref();

    let counted = false;
    res.on('finish', () => {
      counted = true;
      if (timer) clearTimeout(timer);
      if (!stream()) record(name(), now() - t0, res.statusCode);
    });
    res.on('close', () => {
      if (timer) clearTimeout(timer);
      // closed with no reply sent: the client gave up. 499 keeps it visible
      if (!counted && !stream()) record(name(), now() - t0, 499);
    });
    next();
  }

  return { middleware, record, snapshot };
}
