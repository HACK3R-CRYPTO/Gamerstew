// ─── The chain outbox: scores wait here to be sent on-chain ──────────────────
// A score is checked and saved first. Sending it to the chain is a separate job
// done from this queue, so a player never waits on the chain and a failed send
// can never lose a score.
//
// The rules, each of which has a test:
//   - one row per session ticket. Queueing the same run twice is one row.
//   - a send that fails for a passing reason (network, busy chain, low gas) is
//     tried again later, waiting longer each time.
//   - a send the chain will never accept (the player has no GamePass, we are
//     not the authorised sender) is marked failed and left alone.
//   - a row is never sent twice. A row that was sent and has no receipt yet is
//     only sent again once the chain itself says the transaction is gone.
//   - out of gas stops the whole queue. Nothing is marked failed for it: the
//     rows wait and go out when the wallet is topped up.
//   - `confirmed` is the only state prizes may count.
//
// Nothing here knows about Express, Supabase or ethers. Those come in as ports.

export type OutboxStatus = 'pending' | 'sent' | 'confirmed' | 'failed';
export interface OutboxRow { id: number; session_token: string; wallet: string; game: string; game_type: number; score: number; status: OutboxStatus; attempts: number; tx_hash: string | null; sent_at: string | null }
export interface NewRow { sessionToken: string; wallet: string; game: string; gameType: number; score: number }

export interface OutboxStore {
  /** Insert, or return the row already there for this ticket. Never two rows. */
  enqueue(row: NewRow): Promise<{ ok: true; id: number; created: boolean } | { ok: false }>;
  /** Take up to `limit` pending rows that are due and hold them for `leaseMs`,
   *  so a second worker (or this one after a crash) does not take them too. */
  claim(limit: number, leaseMs: number): Promise<OutboxRow[]>;
  markSent(id: number, txHash: string): Promise<void>;
  markConfirmed(id: number): Promise<void>;
  markFailed(id: number, reason: string): Promise<void>;
  /** Back to pending, due again after `delayMs`. */
  retryLater(id: number, delayMs: number, reason: string): Promise<void>;
  /** Rows sent at least `olderThanMs` ago that have no confirmation yet. */
  sentUnconfirmed(olderThanMs: number, limit: number): Promise<OutboxRow[]>;
  counts(): Promise<{ pending: number; sent: number; confirmed: number; failed: number; oldestPendingMs: number | null }>;
}

export interface OutboxChain {
  /** Send the score. Resolves with the transaction hash once it is SUBMITTED. */
  submitScore(wallet: string, gameType: number, score: number): Promise<{ hash: string }>;
  /** 'ok' mined and succeeded · 'reverted' mined and failed · 'pending' known,
   *  not mined yet · 'gone' the chain has no such transaction. */
  txState(hash: string): Promise<'ok' | 'reverted' | 'pending' | 'gone'>;
}

export const MAX_ATTEMPTS = 12;
export const BATCH = 20;
export const LEASE_MS = 60_000;
export const CONFIRM_AFTER_MS = 8_000;
export const RESEND_AFTER_MS = 3 * 60_000;

/** 5 s, 10 s, 20 s … capped at 5 minutes. */
export const backoffMs = (attempts: number): number => Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

const text = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? '')).toLowerCase();
/** The chain will never accept this, however many times it is sent. */
export const isPermanent = (e: unknown): boolean => /no game pass|not authorised|not authorized|execution reverted/.test(text(e)) && !isOutOfGas(e);
/** The sending wallet cannot pay. Every later send would fail the same way. */
export const isOutOfGas = (e: unknown): boolean => /insufficient funds|insufficient balance/.test(text(e));

export interface Logger { log(m: string): void; warn(m: string, ...e: unknown[]): void }

export function createOutbox(deps: { store: OutboxStore; chain: OutboxChain; logger?: Logger; now?: () => number }) {
  const log = deps.logger ?? { log: (m) => console.log(m), warn: (m, ...e) => console.warn(m, ...e) };
  let outOfGas = false;

  /** Queue a checked score. Safe to call twice for the same ticket. */
  async function enqueue(row: NewRow) { return deps.store.enqueue(row); }

  /** Send what is due. Returns what happened, for the job log and the tests. */
  async function sendDue(): Promise<{ sent: number; retried: number; failed: number; stopped: boolean }> {
    const out = { sent: 0, retried: 0, failed: 0, stopped: false };
    const rows = await deps.store.claim(BATCH, LEASE_MS);
    for (const row of rows) {
      // sent before, no receipt recorded: the confirm pass decides its fate, never a blind resend
      if (row.tx_hash) continue;
      try {
        const tx = await deps.chain.submitScore(row.wallet, row.game_type, row.score);
        await deps.store.markSent(row.id, tx.hash);
        outOfGas = false;
        out.sent++;
      } catch (e) {
        if (isOutOfGas(e)) {
          // Stop here. The rest of the batch would fail the same way; their leases
          // lapse and they are picked up again once the wallet has gas.
          if (!outOfGas) log.warn('[outbox] the sending wallet is out of gas: queue paused, nothing lost');
          outOfGas = true; out.stopped = true;
          await deps.store.retryLater(row.id, 60_000, 'out of gas');
          break;
        }
        if (isPermanent(e) || row.attempts >= MAX_ATTEMPTS) {
          await deps.store.markFailed(row.id, text(e).slice(0, 200));
          out.failed++;
          log.warn(`[outbox] gave up on #${row.id} (${row.game} ${row.wallet.slice(0, 10)}…):`, text(e).slice(0, 120));
        } else {
          await deps.store.retryLater(row.id, backoffMs(row.attempts), text(e).slice(0, 200));
          out.retried++;
        }
      }
    }
    return out;
  }

  /** Look at what was sent and has no confirmation yet. */
  async function confirmSent(): Promise<{ confirmed: number; reverted: number; resend: number; waiting: number }> {
    const out = { confirmed: 0, reverted: 0, resend: 0, waiting: 0 };
    const now = (deps.now ?? Date.now)();
    for (const row of await deps.store.sentUnconfirmed(CONFIRM_AFTER_MS, 50)) {
      if (!row.tx_hash) continue;
      let state: Awaited<ReturnType<OutboxChain['txState']>>;
      try { state = await deps.chain.txState(row.tx_hash); } catch { out.waiting++; continue; } // cannot tell: change nothing
      if (state === 'ok') { await deps.store.markConfirmed(row.id); out.confirmed++; }
      else if (state === 'reverted') { await deps.store.markFailed(row.id, 'reverted on-chain'); out.reverted++; }
      else if (state === 'gone' && row.sent_at && now - Date.parse(row.sent_at) > RESEND_AFTER_MS) {
        // only when the chain itself has no trace of it, and only after a wait
        await deps.store.retryLater(row.id, 0, 'transaction dropped: sending again');
        out.resend++;
      } else out.waiting++;
    }
    return out;
  }

  async function status() { return { ...(await deps.store.counts()), outOfGas }; }

  return { enqueue, sendDue, confirmSent, status };
}
export type Outbox = ReturnType<typeof createOutbox>;
