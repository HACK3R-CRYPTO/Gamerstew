// ─── Remembering an answer, safely ───────────────────────────────────────────
// Several pages ask for results that are expensive to work out and rarely or
// never change: the table of a competition that ended months ago, a finished
// challenge. Working them out again on every page view is the single most
// common reason a route here is slow.
//
// This is the one cache for that, with the rules that are easy to get wrong
// built in:
//
//   - a FAILED attempt is never remembered. If the work throws, nothing is
//     stored, and the next request tries again.
//   - if a refresh fails and an older answer is held, the older answer is
//     served. A stale table beats an error page.
//   - visitors arriving together share one piece of work.
//   - the lifetime is decided per call, so a caller can say "ten seconds while
//     the event is live, half an hour once it is over".
//   - it is bounded: it cannot grow without limit.
//
// It lives in this process's memory, like the other caches. With more than one
// server each would hold its own copy, which is safe for results like these.

export interface ResultCache {
  get<T>(key: string, opts: { ttlMs: number; compute: () => Promise<T> }): Promise<T>;
  /** forget one key, or everything */
  drop(key?: string): void;
  size(): number;
}

export function createResultCache(opts: { now?: () => number; maxEntries?: number; log?: (msg: string, extra?: unknown) => void } = {}): ResultCache {
  const now = opts.now ?? Date.now;
  const max = opts.maxEntries ?? 200;
  const log = opts.log ?? ((m, e) => console.warn(m, e ?? ''));
  const held = new Map<string, { value: unknown; at: number }>();
  const inFlight = new Map<string, Promise<unknown>>();

  return {
    async get<T>(key: string, { ttlMs, compute }: { ttlMs: number; compute: () => Promise<T> }): Promise<T> {
      const have = held.get(key);
      if (have && now() - have.at < ttlMs) return have.value as T;
      let work = inFlight.get(key) as Promise<T> | undefined;
      if (!work) {
        work = compute()
          .then((value) => {
            held.delete(key); // re-insert so the newest is last, and the oldest is evicted first
            held.set(key, { value, at: now() });
            if (held.size > max) held.delete(held.keys().next().value as string);
            return value;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, work);
      }
      try {
        return await work;
      } catch (e) {
        if (have) {
          log(`⚠️  refresh of "${key}" failed, serving the previous result:`, (e as { message?: unknown })?.message ?? e);
          return have.value as T;
        }
        throw e;
      }
    },
    drop(key?: string) { if (key === undefined) held.clear(); else held.delete(key); },
    size: () => held.size,
  };
}

/** Lifetime for the result of an event with an end time: short while it runs,
 *  long once it has been over for `settleMs` (a late write can no longer land). */
export function eventTtl(endsAtMs: number, nowMs: number, live = 10_000, over = 30 * 60_000, settleMs = 10 * 60_000): number {
  return nowMs >= endsAtMs + settleMs ? over : live;
}
