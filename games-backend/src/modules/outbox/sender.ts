// ─── Sending a batch of scores with one network call each ────────────────────
// Sending through the contract object costs eleven calls a score (measured: the
// nonce, a gas estimate, the chain id three times, a block, two fee lookups…),
// all one after another. At about a tenth of a second a call that is roughly
// one score a second, which is the ceiling for the whole app.
//
// Here the things that do not change between scores are looked up once per
// batch (nonce) or kept for a few seconds (gas price), the gas limit is fixed,
// and each score is signed locally and handed to the chain in ONE call.
//
// The whole batch runs inside the wallet's single write lane (`serialize`), so
// nothing else can use a nonce in the middle of it.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BatchRow { wallet: string; game_type: number; score: number }
export type BatchResult = { hash: string } | { error: unknown };

// A first score for a player in a game writes fresh storage: 118,898 gas
// measured. A later one: 50,498. Twice the worst case.
export const SCORE_GAS_LIMIT = 250_000n;
const PRICE_TTL_MS = 10_000;
const PRICE_HEADROOM = 130n; // percent: the price can rise between lookup and inclusion

export function createBatchSender(deps: {
  provider: () => any;
  signer: () => any;                     // an ethers Wallet for the authorised sender
  contract: string;
  encode: (wallet: string, gameType: number, score: number) => string;
  /** does this wallet hold a GamePass? A score for one that does not would revert and still cost gas. */
  hasPass: (wallet: string) => Promise<boolean>;
  /** run inside the wallet's single write lane */
  serialize: <T>(fn: () => Promise<T>) => Promise<T>;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let price: { value: bigint; at: number } | null = null;
  let chainId: bigint | null = null;
  const passes = new Set<string>(); // a pass cannot be un-minted: a yes is kept for good

  async function gasPrice(): Promise<bigint> {
    if (price && now() - price.at < PRICE_TTL_MS) return price.value;
    const raw = BigInt(await deps.provider().send('eth_gasPrice', []));
    price = { value: (raw * PRICE_HEADROOM) / 100n, at: now() };
    return price.value;
  }
  async function holdsPass(wallet: string): Promise<boolean> {
    const w = wallet.toLowerCase();
    if (passes.has(w)) return true;
    const yes = await deps.hasPass(wallet);
    if (yes) passes.add(w);
    return yes;
  }

  /** Send rows in order. Stops at the first failure: the rows after it are not
   *  attempted (their nonces would leave a gap) and get no result. */
  function submitMany(rows: BatchRow[]): Promise<BatchResult[]> {
    return deps.serialize(async () => {
      const out: BatchResult[] = [];
      if (rows.length === 0) return out;
      const provider = deps.provider(); const signer = deps.signer();
      try {
        if (chainId === null) chainId = BigInt((await provider.getNetwork()).chainId);
        let nonce: number = await provider.getTransactionCount(await signer.getAddress(), 'pending');
        const gp = await gasPrice();
        for (const r of rows) {
          try {
            if (!(await holdsPass(r.wallet))) throw new Error('execution reverted: no game pass');
            const raw = await signer.signTransaction({ to: deps.contract, data: deps.encode(r.wallet, r.game_type, r.score), nonce, gasLimit: SCORE_GAS_LIMIT, gasPrice: gp, chainId, type: 0, value: 0n });
            const hash: string = await provider.send('eth_sendRawTransaction', [raw]);
            nonce++;
            out.push({ hash });
          } catch (e) {
            // a pass check is not a send: it used no nonce, so carry on with the next row
            if (/no game pass/i.test(String((e as Error)?.message ?? e))) { out.push({ error: e }); continue; }
            price = null; // the price may be what was wrong: look it up again next time
            out.push({ error: e });
            break;
          }
        }
      } catch (e) {
        out.push({ error: e }); // could not even read the nonce or the price
      }
      return out;
    });
  }
  return { submitMany };
}
