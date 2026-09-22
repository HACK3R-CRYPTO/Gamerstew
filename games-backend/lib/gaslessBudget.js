// ─── Gasless write budget ────────────────────────────────────────────────────
// The backend signer pays for every gasless recordScore, so an attacker who
// rotates wallets and IPs can drain its CELO outright. Rate limits bound the
// RATE; this bounds the TOTAL. Two ceilings, both reset at UTC midnight:
//
//   per-wallet — generous for a real player, useless for a sybil fleet on its
//                own (160 wallets get 160 buckets), which is why...
//   global     — ...this exists. It makes the worst-case daily spend a known
//                number rather than "whatever is in the wallet".
//
// Extracted from server.js so it can be tested without booting the server.

function createGaslessBudget({ perWalletPerDay, globalPerDay, now = Date.now } = {}) {
  const perWallet = Number(perWalletPerDay);
  const global = Number(globalPerDay);
  let day = '';
  let globalUsed = 0;
  let byWallet = new Map();

  function roll() {
    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) { day = today; globalUsed = 0; byWallet = new Map(); }
  }

  return {
    check(wallet) {
      roll();
      if (globalUsed >= global) return { ok: false, reason: 'global_gasless_cap' };
      const w = String(wallet || '').toLowerCase();
      if ((byWallet.get(w) || 0) >= perWallet) return { ok: false, reason: 'wallet_gasless_cap' };
      return { ok: true };
    },
    consume(wallet) {
      roll();
      const w = String(wallet || '').toLowerCase();
      globalUsed += 1;
      byWallet.set(w, (byWallet.get(w) || 0) + 1);
    },
    stats() { roll(); return { day, globalUsed, wallets: byWallet.size }; },
  };
}

module.exports = { createGaslessBudget };
