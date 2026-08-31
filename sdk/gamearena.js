// GameArena Partner SDK — tiny client for third-party games to plug into GameArena.
// Works in the browser and in Node 18+ (global fetch). No dependencies.
//
//   import { GameArena } from "./gamearena.js";
//   const arena = new GameArena({ apiKey: process.env.GAMEARENA_KEY });
//
//   await arena.submitScore("0xPlayer...", 41280);   // push a score onto GameArena boards
//   const ok = await arena.isVerified("0xPlayer..."); // GoodDollar proof-of-humanity check
//   const board = await arena.leaderboard(20);        // read your board back
//
// Your API key identifies your game — keep it server-side for score writes.

const DEFAULT_BASE = "https://game-backend-production-6130.up.railway.app";

export class GameArena {
  /** @param {{ apiKey: string, baseUrl?: string }} opts */
  constructor({ apiKey, baseUrl = DEFAULT_BASE } = {}) {
    if (!apiKey) throw new Error("GameArena: apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async _req(path, opts = {}) {
    const res = await fetch(this.baseUrl + path, {
      ...opts,
      headers: {
        "x-partner-key": this.apiKey,
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`GameArena ${res.status}: ${body.error || res.statusText}`);
    }
    return body;
  }

  /**
   * Record a player's score onto GameArena's leaderboards. Best-score-per-wallet
   * is kept automatically. Call this server-side (keeps your key private).
   * @param {string} wallet  0x address
   * @param {number} score   final score for the run
   * @param {string} [txHash] optional on-chain tx hash for proof
   */
  submitScore(wallet, score, txHash) {
    return this._req("/api/partner/score", {
      method: "POST",
      body: JSON.stringify({ wallet, score, txHash }),
    });
  }

  /**
   * Is this wallet a GoodDollar-verified human? Use it to gate rewards / show a
   * verified badge without building your own verification.
   * @param {string} wallet 0x address
   * @returns {Promise<boolean>}
   */
  async isVerified(wallet) {
    const r = await this._req(`/api/partner/verified/${wallet}`);
    return !!r.verified;
  }

  /**
   * Read your game's leaderboard back from GameArena.
   * @param {number} [limit=20]
   */
  leaderboard(limit = 20) {
    return this._req(`/api/partner/leaderboard?limit=${encodeURIComponent(limit)}`);
  }
}

export default GameArena;
