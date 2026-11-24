// ─── Reading purchases from the chain ────────────────────────────────────────
// The PerkShop and HabitatRegistry contracts emit an event for every purchase,
// with the exact split between the UBI pool and GameArena's treasury. This
// walks the chain in order, a block range at a time, and stores them.
//
// What makes it safe to run forever:
//   • it only ever moves forward from a stored cursor, and the cursor moves in
//     the same database call that stores the range's purchases, so a range is
//     never half recorded and never skipped;
//   • a range that fails is tried again next time, smaller;
//   • it stays a few blocks behind the head, so a reorg cannot leave a purchase
//     recorded that did not happen;
//   • it says so, loudly, when it falls far behind. The subgraph went quiet for
//     three weeks with nothing in the logs.

export interface Purchase { tx_hash: string; log_index: number; block: number; at: number; kind: 'perk' | 'habitat'; wallet: string; item: number; total: string; ubi: string; treasury: string }
export interface ChainReader {
  head(): Promise<number>;
  /** purchases in [from, to], both included, WITHOUT their time */
  purchases(from: number, to: number): Promise<Omit<Purchase, 'at'>[]>;
  /** a block's time, unix seconds */
  blockTime(block: number): Promise<number>;
}
export interface ChainStore { cursor(): Promise<number | null>; save(upto: number, batch: Purchase[]): Promise<boolean> }
export interface IndexResult { from: number; to: number; ranges: number; found: number; behind: number; error?: string }

export const CONFIRMATIONS = 5;
export const MAX_SPAN = 5000; // the public Celo node refuses a wider range

export function createPurchaseIndexer(deps: { reader: ChainReader; store: ChainStore; startBlock: number; logger?: { warn(m: string, ...x: unknown[]): void; error(m: string): void } }) {
  let span = MAX_SPAN; let running = false;
  return {
    /** Read up to `maxRanges` block ranges. Call it on a timer. */
    async run(maxRanges = 40): Promise<IndexResult> {
      if (running) return { from: 0, to: 0, ranges: 0, found: 0, behind: 0, error: 'busy' };
      running = true;
      const out: IndexResult = { from: 0, to: 0, ranges: 0, found: 0, behind: 0 };
      try {
        const head = (await deps.reader.head()) - CONFIRMATIONS;
        let next = ((await deps.store.cursor()) ?? deps.startBlock - 1) + 1;
        out.from = next;
        while (out.ranges < maxRanges && next <= head) {
          const to = Math.min(head, next + span - 1);
          let rows: Omit<Purchase, 'at'>[];
          try { rows = await deps.reader.purchases(next, to); }
          catch (e) {
            // too wide for the node, or a passing error: try again with half, next time if need be
            span = Math.max(250, Math.floor(span / 2)); out.error = String((e as Error)?.message || e).slice(0, 160);
            deps.logger?.warn(`[chain] reading ${next}..${to} failed, range now ${span}:`, out.error); break;
          }
          const times = new Map<number, number>();
          for (const b of new Set(rows.map((r) => r.block))) times.set(b, await deps.reader.blockTime(b));
          const batch: Purchase[] = rows.map((r) => ({ ...r, at: times.get(r.block)! }));
          if (!(await deps.store.save(to, batch))) { out.error = 'could_not_store'; break; }
          out.found += batch.length; out.ranges++; out.to = to; next = to + 1;
          if (span < MAX_SPAN) span = Math.min(MAX_SPAN, span * 2); // a range that worked: widen again
        }
        out.behind = Math.max(0, head - (next - 1));
        // far behind AND not reading at full speed: that is a stall, not a first catch-up
        if (out.behind > 600_000 && out.ranges < maxRanges) deps.logger?.error(`🚨 [chain] the purchase reader is ${out.behind.toLocaleString()} blocks behind the chain`);
        return out;
      } catch (e) { return { ...out, error: String((e as Error)?.message || e).slice(0, 160) }; } finally { running = false; }
    },
  };
}
