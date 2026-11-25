// ─── Unfinished runs, on the chain ───────────────────────────────────────────
// A run a player starts and never finishes used to leave nothing on the chain:
// only a finished run records a score. The owner wants every game a player
// opens to be a transaction. So a run that was started, never finished, and is
// now too old to finish is written down as a transaction of its own.
//
// It is deliberately NOT a score. A score of zero on the GamePass contract
// would be read by everything that counts games played (the weekly challenge
// pays by games played), and a player could then earn by opening games and
// closing them. This is a plain transaction from the server's wallet to itself
// that moves nothing and carries a note anyone can read:
//
//     GameArena · unfinished run · <game> · <player's address>
//
// It counts for nothing, ranks nowhere and cannot be farmed, and it is still a
// real, permanent transaction that the dashboard links to.
//
// Limits, because the server pays the gas: a few per pass, a cap per player a
// day (so opening and closing games cannot be used to drain the wallet), and a
// cap for the whole day.

export interface OpenRun { token: string; wallet: string; game: string; startedAt: string }
export interface UnfinishedStore {
  /** runs started between the two times, never finished, with no transaction yet; oldest first */
  open(olderThanIso: string, newerThanIso: string, limit: number): Promise<OpenRun[]>;
  /** write the transaction down against the run. false: could not save */
  mark(token: string, txHash: string): Promise<boolean>;
  /** the player of every unfinished run started since `sinceIso` that already has its transaction.
   *  This is how the day's limits survive a restart: the count is read back, not remembered. */
  sent?(sinceIso: string): Promise<string[] | null>;
}
export interface UnfinishedOptions {
  store: UnfinishedStore;
  /** send the note as a transaction; resolves to its hash */
  send: (note: string) => Promise<string>;
  now?: () => number;
  /** a run can no longer be finished after this long */
  settleMs?: number;
  /** runs older than this are left alone: history is not rewritten */
  maxAgeMs?: number;
  perPass?: number; perWalletPerDay?: number; perDay?: number;
}
export const noteFor = (r: { game: string; wallet: string }) => `GameArena · unfinished run · ${String(r.game).replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'game'} · ${String(r.wallet).toLowerCase()}`;

export function createUnfinishedRecorder(o: UnfinishedOptions) {
  const now = o.now ?? Date.now;
  const settle = o.settleMs ?? 15 * 60 * 1000, maxAge = o.maxAgeMs ?? 6 * 60 * 60 * 1000;
  const perPass = o.perPass ?? 8, perWallet = o.perWalletPerDay ?? 20, perDay = o.perDay ?? 1500;
  let day = ''; let sentToday = 0; const byWallet = new Map<string, number>(); const given = new Set<string>(); // runs passed over for today, so they are not looked at again every pass
  let busy = false;
  let counted = false; // today's count has been read back from the store (after a restart, memory starts empty)

  return {
    /** One pass. Returns what it did; never throws. */
    async sweep(): Promise<{ sent: number; skipped: number; failed: number }> {
      const out = { sent: 0, skipped: 0, failed: 0 };
      if (busy) return out;
      busy = true;
      try {
        const t = now(); const today = new Date(t).toISOString().slice(0, 10);
        if (today !== day) { day = today; sentToday = 0; byWallet.clear(); given.clear(); counted = false; }
        if (!counted && o.store.sent) {
          const wallets = await o.store.sent(`${today}T00:00:00.000Z`).catch(() => null);
          if (wallets) {
            counted = true; byWallet.clear();
            for (const w of wallets) { const k = String(w).toLowerCase(); byWallet.set(k, (byWallet.get(k) ?? 0) + 1); }
            sentToday = Math.max(sentToday, wallets.length);
          } else return out; // the limits are not known yet: send nothing rather than guess
        }
        if (sentToday >= perDay) return out;
        const runs = await o.store.open(new Date(t - settle).toISOString(), new Date(t - maxAge).toISOString(), perPass * 4).catch(() => [] as OpenRun[]);
        for (const r of runs) {
          if (out.sent >= perPass || sentToday >= perDay) break;
          const w = String(r.wallet || '').toLowerCase();
          if (!/^0x[a-f0-9]{40}$/.test(w) || given.has(r.token)) { out.skipped++; continue; }
          if ((byWallet.get(w) ?? 0) >= perWallet) { given.add(r.token); out.skipped++; continue; }
          try {
            const hash = await o.send(noteFor(r));
            if (!/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error('no hash');
            // a run that cannot be marked would be sent again next pass: stop looking at it either way
            given.add(r.token); await o.store.mark(r.token, hash).catch(() => false);
            byWallet.set(w, (byWallet.get(w) ?? 0) + 1); sentToday++; out.sent++;
          } catch { out.failed++; break; } // the wallet is out of gas or the node is down: try again next pass, do not hammer
        }
        if (given.size > 20000) given.clear();
        return out;
      } finally { busy = false; }
    },
    stats: () => ({ day, sentToday }),
  };
}
