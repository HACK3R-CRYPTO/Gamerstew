// ─── Cash out: G$ to naira in the player's own bank account ──────────────────
// Paid by GoodCash (pay.goodcash.xyz). GameArena never holds the money: the
// player's wallet signs one transaction and GoodCash's router pays the bank.
//
// The whole feature is OFF until NEXT_PUBLIC_GOODCASH_KEY holds a publishable
// key (gc_pk_test_… or gc_pk_live_…). A publishable key is safe in the browser:
// it only works from the sites GoodCash has on our list. The secret key and the
// webhook secret live on the game server only.

export const CASHOUT_KEY = (process.env.NEXT_PUBLIC_GOODCASH_KEY || "").trim();
/** a stand-in for a developer's machine only; never set in the real app */
const fake = () => process.env.NODE_ENV !== "production" && typeof window !== "undefined" && !!(window as unknown as { __cashoutFake?: boolean }).__cashoutFake;
export const cashOutOn = () => /^gc_pk_(test|live)_[A-Za-z0-9_-]+$/.test(CASHOUT_KEY) || fake();
export const cashOutIsTest = () => CASHOUT_KEY.startsWith("gc_pk_test_") || fake();
export const cashOutFake = fake;

export const OPEN_CASHOUT = "ga:cashout-open";
export function openCashOut(from: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_CASHOUT, { detail: { from } }));
}

export const naira = (n: number) => `₦${Math.floor(n).toLocaleString("en-NG")}`;
export const gAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

// The last bank account used, on this phone only. It never goes to GameArena's
// servers: the browser sends it straight to GoodCash when the player cashes out.
export interface SavedBank { bankCode: string; bankName: string; accountNumber: string; accountName: string }
const BANK_KEY = "gamearena:cashout:bank";
export function savedBank(): SavedBank | null {
  try { const v = JSON.parse(window.localStorage.getItem(BANK_KEY) || "null"); return v && typeof v.bankCode === "string" && /^\d{10}$/.test(v.accountNumber) && typeof v.accountName === "string" ? v : null; } catch { return null; }
}
export function saveBank(b: SavedBank | null) { try { if (b) window.localStorage.setItem(BANK_KEY, JSON.stringify(b)); else window.localStorage.removeItem(BANK_KEY); } catch { /* private window */ } }

// Cash outs started from this phone, newest first, so a player can always find
// one again: the answer to "did it go?" is here, never "try again".
export interface Recent { id: string; amountG: string; naira: number; at: number; bankName: string; last4: string; status: string }
const recentKey = (wallet: string) => `gamearena:cashout:recent:${wallet.toLowerCase()}`;
export function recentCashOuts(wallet: string | undefined): Recent[] {
  if (!wallet) return [];
  try { const v = JSON.parse(window.localStorage.getItem(recentKey(wallet)) || "[]"); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; }
}
export function rememberCashOut(wallet: string | undefined, r: Recent) {
  if (!wallet) return;
  try { window.localStorage.setItem(recentKey(wallet), JSON.stringify([r, ...recentCashOuts(wallet).filter((x) => x.id !== r.id)].slice(0, 12))); } catch { /* private window */ }
}
export function updateCashOut(wallet: string | undefined, id: string, status: string) {
  if (!wallet) return;
  try { window.localStorage.setItem(recentKey(wallet), JSON.stringify(recentCashOuts(wallet).map((x) => (x.id === id ? { ...x, status } : x)))); } catch { /* private window */ }
}

/** How a status reads to a player. */
export const STATUS_WORDS: Record<string, string> = { awaiting_signature: "Not sent", sent: "Sent", processing: "Paying your bank", paid: "Paid", failed: "Not paid", refunded: "Sent back to you", expired: "Ran out" };
export const isOver = (status: string) => status === "paid" || status === "failed" || status === "refunded" || status === "expired";
