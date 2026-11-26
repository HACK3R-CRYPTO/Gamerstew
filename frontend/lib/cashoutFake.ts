// A stand-in for GoodCash on a developer's machine, so the screens can be
// walked through without a key. It behaves like GoodCash's own test mode:
// fixed prices, two test banks, any 10-digit account, paid after a few seconds.
// It is only ever loaded when NODE_ENV is not production AND a test flag is set.
import type { GoodCash, CashOut, Quote } from "@goodcash/sdk";
import { GoodCashError } from "@goodcash/sdk";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function fakeGoodCash(): GoodCash {
  const made = new Map<string, { c: CashOut; at: number; account: string }>();
  const quote = (amountG: string | number): Quote => {
    const g = Number(amountG); const usd = g * 0.0001; const afterExit = usd * 0.9; const fee = afterExit * 0.03; const ngn = Math.max(0, (afterExit - fee) * 1500 - 30);
    return {
      object: "quote", mode: "test", amountG: String(amountG), receive: { naira: Math.floor(ngn), minimumNaira: Math.floor(ngn * 0.985) }, feePercent: 3, minimumG: 2000, enough: g >= 2000, nairaPerDollar: 1500,
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      fees: [
        { type: "gooddollar_contribution", label: "GoodDollar contribution", percent: 10, amountG: (g * 0.1).toFixed(2) },
        { type: "goodcash_fee", label: "GoodCash fee", percent: 1, naira: Math.round(fee * 1500 / 3) },
        { type: "partner_fee", label: "GameArena fee", percent: 2, naira: Math.round(fee * 1500 * 2 / 3) },
        { type: "payout_fee", label: "Bank payout fee", naira: 30 },
      ],
    };
  };
  const statusOf = (id: string): CashOut => {
    const m = made.get(id); if (!m) throw new GoodCashError("not_found");
    const age = Date.now() - m.at;
    const end = m.account === "0000000001" ? "failed" : m.account === "0000000002" ? "refunded" : m.account === "0000000003" ? "processing" : "paid";
    const status = age < 2500 ? "sent" : age < 7000 ? "processing" : end;
    return { ...m.c, status: status as CashOut["status"], paidAt: status === "paid" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
  };
  const client = {
    mode: "test" as const,
    quote: async ({ amountG }: { amountG: string | number }) => { await wait(350); return quote(amountG); },
    banks: async () => { await wait(300); return [{ code: "TESTBANKA", name: "Test Bank A", popular: true }, { code: "TESTBANKB", name: "Test Bank B", popular: true }, { code: "GTB", name: "Guaranty Trust Bank", popular: true }, { code: "ACCESS", name: "Access Bank", popular: true }, { code: "OPAY", name: "OPay", popular: true }, { code: "KUDA", name: "Kuda Microfinance Bank", popular: false }, { code: "ZENITH", name: "Zenith Bank", popular: false }, { code: "UBA", name: "United Bank for Africa", popular: false }, { code: "PALMPAY", name: "PalmPay", popular: false }]; },
    verifyAccount: async ({ accountNumber }: { bankCode: string; accountNumber: string }) => { await wait(700); if (accountNumber === "0000000009") throw new GoodCashError("bank_account_not_found", { message: "We could not find that account. Check the bank and the number." }); return { accountName: "TEST ACCOUNT" }; },
    cashOut: async (args: { amountG: string | number; wallet?: string; recipient: { accountNumber: string }; partnerRef?: string; onStep?: (s: string, c?: CashOut) => void }) => {
      const step = args.onStep ?? (() => {});
      step("checking"); await wait(500);
      if (String(args.amountG) === "2222") throw new GoodCashError("needs_network_fee", { message: "Your wallet needs a little CELO to pay the network fee.", data: { needCelo: 0.01, haveCelo: 0.001, enough: false } });
      step("creating"); await wait(700);
      const q = quote(args.amountG); const id = `co_test_${Math.random().toString(36).slice(2, 10)}`; const now = new Date().toISOString();
      const c: CashOut = { id, object: "cashout", mode: "test", status: "awaiting_signature", wallet: args.wallet ?? "0x0000000000000000000000000000000000007e57", amountG: String(args.amountG), receive: q.receive, feePercent: q.feePercent, partnerRef: args.partnerRef ?? null, txHash: null, expiresAt: now, createdAt: now, updatedAt: now, paidAt: null };
      step("confirm_in_wallet", c); await wait(1200);
      if (String(args.amountG) === "3333") throw new GoodCashError("wallet_rejected");
      made.set(id, { c: { ...c, status: "sent", txHash: "0x" + "ab".repeat(32) }, at: Date.now(), account: args.recipient.accountNumber });
      const sent = statusOf(id); step("done", sent);
      return { cashOut: sent, txHash: sent.txHash ?? "" };
    },
    getCashOut: async (id: string) => statusOf(id),
    watchCashOut: async (id: string, onChange: (c: CashOut) => void, opts?: { signal?: AbortSignal }) => {
      let last = "";
      for (;;) {
        if (opts?.signal?.aborted) throw new Error("stopped");
        const c = statusOf(id); if (c.status !== last) { last = c.status; onChange(c); }
        if (["paid", "failed", "refunded", "expired"].includes(c.status)) return c;
        await wait(800);
      }
    },
  };
  return client as unknown as GoodCash;
}
