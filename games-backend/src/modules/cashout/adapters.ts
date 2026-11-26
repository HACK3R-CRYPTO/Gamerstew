// The real database, behind the cash-out ports. Both tables are locked to the
// server (RLS on, no policies), so this must be given the service-role client.
import type { CashoutRow, CashoutStore } from './service';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Db { from(table: string): any; rpc(fn: string, args: Record<string, unknown>): any }

export function supabaseCashouts(db: Db): CashoutStore {
  return {
    async save(r: CashoutRow) {
      // cashout_save never moves a finished cash out back (see the migration)
      const { error } = await db.rpc('cashout_save', { p_id: r.id, p_wallet: r.wallet, p_amount_g: r.amount_g, p_naira: r.naira, p_fee_percent: r.fee_percent, p_status: r.status, p_mode: r.mode, p_tx_hash: r.tx_hash, p_created_at: r.created_at, p_paid_at: r.paid_at });
      return !error;
    },
    async event(id: string, type: string, cashout: string) {
      const { error } = await db.from('cashout_events').insert({ id, type, cashout_id: cashout });
      if (!error) return 'new';
      return String(error.code) === '23505' ? 'seen' : 'failed'; // 23505: that event id is already there
    },
  };
}
