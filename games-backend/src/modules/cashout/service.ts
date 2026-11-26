// ─── Cash outs: what GoodCash tells us ───────────────────────────────────────
// A player turns G$ into naira with GoodCash (frontend/components/cashout).
// GameArena never holds that money and never moves it: the player's own wallet
// signs, GoodCash's router pays the bank. What reaches this server is the
// NEWS: GoodCash calls POST /api/goodcash/webhook each time a cash out changes
// (sent, processing, paid, failed, refunded).
//
// With that news this module does two things, and nothing else:
//   - keeps one row per cash out, so the dashboard can count them;
//   - tells the player in their bell (and by push if they allow it) when the
//     money has landed, or has not.
//
// Every call is checked: GoodCash signs the exact bytes it sent with a secret
// only the two of us hold. An unsigned, altered or stale call is refused, so
// nobody can invent a "paid" message. The same event arriving twice (GoodCash
// retries) is told to the player once.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Reply { status: number; body: Record<string, unknown> }
export interface Note { title: string; body: string; url: string; tag: string }
export interface CashoutRow {
  id: string; wallet: string | null; amount_g: number; naira: number; fee_percent: number | null;
  status: string; mode: 'live' | 'test'; tx_hash: string | null; created_at: string | null; paid_at: string | null;
}
export interface CashoutStore {
  /** Keep the cash out as it now stands. A finished one is never moved back. false: could not be saved */
  save(row: CashoutRow): Promise<boolean>;
  /** Note that this event was handled. 'seen' when it already had been; 'failed' when that could not be told */
  event(id: string, type: string, cashout: string): Promise<'new' | 'seen' | 'failed'>;
}

export const STATUSES = ['awaiting_signature', 'sent', 'processing', 'paid', 'failed', 'refunded', 'expired'];
export const TOLERANCE_S = 300;
const WALLET = /^0x[a-f0-9]{40}$/;

/** GoodCash-Signature: t=<unix seconds>,v1=<hex of HMAC-SHA256(secret, "<t>.<raw body>")> */
export function verifySignature(raw: Buffer | string, header: unknown, secret: string, nowMs: number): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(typeof header === 'string' ? header : '');
  if (!m || !secret) return false;
  if (Math.abs(nowMs / 1000 - Number(m[1])) > TOLERANCE_S) return false;
  const want = createHmac('sha256', secret).update(`${m[1]}.`).update(raw).digest();
  const got = Buffer.from(m[2]!, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

const money = (n: number) => `₦${Math.floor(n).toLocaleString('en-NG')}`;
const gs = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} G$`;

/** What the player is told, by what happened. null: nothing worth a message. */
export function noteFor(type: string, row: CashoutRow): Note | null {
  const test = row.mode === 'test' ? 'Test: ' : ''; const tag = `cashout-${row.id}`; const url = '/dashboard';
  if (type === 'cashout.paid') return { title: `${test}${money(row.naira)} paid to your bank`, body: `Your cash out of ${gs(row.amount_g)} has arrived.`, url, tag };
  if (type === 'cashout.refunded') return { title: `${test}Your cash out was sent back`, body: `The bank could not be paid, so your ${gs(row.amount_g)} is back in your wallet.`, url, tag };
  if (type === 'cashout.failed') return { title: `${test}Your cash out was not paid`, body: `The bank did not take the payment of ${money(row.naira)}. GoodCash is looking at it. Reference: ${row.id}.`, url, tag };
  if (type === 'cashout.delayed') return { title: `${test}Your cash out is taking longer`, body: `${money(row.naira)} is still on its way to your bank. Nothing is lost. We will tell you when it lands.`, url, tag };
  return null;
}

export function createCashouts(deps: {
  store: CashoutStore;
  /** the webhook secret GoodCash gave us (whsec_…). Empty: the door stays shut */
  secret: string;
  /** tell one player something (their bell, and a push if they allow it). Best effort */
  notify?: (wallet: string, category: string, note: Note) => Promise<unknown>;
  now?: () => number;
  logger?: { warn: (...a: unknown[]) => void };
}) {
  const now = deps.now ?? Date.now;
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const iso = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

  return {
    /** One call from GoodCash. `raw` is the body exactly as it arrived. */
    async webhook(raw: Buffer | string | undefined, header: unknown): Promise<Reply> {
      if (!deps.secret) return { status: 503, body: { error: 'not_configured' } };
      if (!raw || !raw.length || raw.length > 64 * 1024) return { status: 400, body: { error: 'bad_body' } };
      if (!verifySignature(raw, header, deps.secret, now())) return { status: 400, body: { error: 'bad_signature' } };
      let evt: { id?: unknown; type?: unknown; data?: Record<string, unknown> };
      try { evt = JSON.parse(raw.toString('utf8')); } catch { return { status: 400, body: { error: 'bad_json' } }; }
      const eventId = typeof evt.id === 'string' ? evt.id.slice(0, 120) : ''; const type = typeof evt.type === 'string' ? evt.type.slice(0, 60) : '';
      if (!eventId || !type.startsWith('cashout.')) return { status: 200, body: { ok: true, ignored: true } }; // top-ups and anything new: thanked, not used
      if (type === 'cashout.test') return { status: 200, body: { ok: true, test: true } };
      const d = evt.data ?? {};
      const id = typeof d.id === 'string' ? d.id.slice(0, 120) : '';
      const status = STATUSES.includes(String(d.status)) ? String(d.status) : '';
      if (!id || !status) return { status: 400, body: { error: 'bad_cashout' } };
      // who it belongs to: the wallet we named when it was started, else the wallet that paid
      const ref = String(d.partnerRef ?? '').toLowerCase(); const from = String(d.wallet ?? '').toLowerCase();
      const receive = (d.receive ?? {}) as { naira?: unknown };
      const row: CashoutRow = {
        id, wallet: WALLET.test(ref) ? ref : WALLET.test(from) ? from : null, amount_g: num(d.amountG), naira: num(receive.naira),
        fee_percent: d.feePercent === undefined || d.feePercent === null ? null : num(d.feePercent), status, mode: d.mode === 'live' ? 'live' : 'test',
        tx_hash: typeof d.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(d.txHash) ? d.txHash.toLowerCase() : null, created_at: iso(d.createdAt), paid_at: iso(d.paidAt),
      };
      // The row first (saving it twice changes nothing), then the event. Were it the other way
      // round, a save that failed would be skipped for good when GoodCash tried again.
      if (!(await deps.store.save(row))) return { status: 500, body: { error: 'not_saved' } }; // GoodCash tries again later
      const seen = await deps.store.event(eventId, type, id);
      if (seen === 'failed') return { status: 500, body: { error: 'not_saved' } };
      if (seen === 'seen') return { status: 200, body: { ok: true, repeat: true } };
      const note = row.wallet ? noteFor(type, row) : null;
      if (note && row.wallet && deps.notify) void deps.notify(row.wallet, `cashout_${id}_${type.slice(8)}`, note).catch((e) => deps.logger?.warn('cashout: the player could not be told:', String((e as Error)?.message ?? e)));
      return { status: 200, body: { ok: true } };
    },
  };
}
export type Cashouts = ReturnType<typeof createCashouts>;
