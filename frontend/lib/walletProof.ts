import { PrivyClient } from "@privy-io/server-auth";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { CONTRACT_ADDRESSES } from "@/lib/contracts";

// ─── Server-side proof that a request really comes from the claimed wallet ───
//
// Two populations, two proofs:
//
//   Browser / Privy users → a Privy access token whose linked wallets include
//     the claimed address. Strong: the token is issued by Privy and verified
//     against their JWKS.
//
//   MiniPay users → MiniPay does NOT support message signing at all (it is
//     listed under "Not Supported" in the official MiniPay integration guide),
//     so there is no signature to check and never will be.
//
// THE TWO PROOFS ARE NOT EQUAL, and conflating them was a real bug.
//
//   STRONG (Privy token): unforgeable, bearer-safe, verified against Privy.
//
//   WEAK (mint tx hash): a transaction hash is PUBLIC the instant the block
//     lands. Anyone watching GamePass logs can read a victim's mint hash and
//     replay it seconds later, so this proves only that the mint happened —
//     never that the caller is the one who made it. It is kept because it
//     meaningfully narrows the attack (a claim must now race the honest
//     client, which posts within ~2s of the mint, inside a short window,
//     instead of being possible forever against any historical wallet) but it
//     must NEVER be treated as authentication:
//       · it may not lock a team assignment (team_locked stays false),
//       · it may not, on its own, be the reason a referrer is recorded where
//         one could be contested later.
//     Reserve irreversible effects for the strong proof.

const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
);

export async function verifyPrivyOwnership(
  accessToken: string,
  claimedWallet: string,
): Promise<boolean> {
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    const user = await privy.getUser(claims.userId);
    const wallets = user.linkedAccounts.filter(
      (a: { type: string }) => a.type === "wallet",
    ) as { type: string; address: string }[];
    return wallets.some(w => w.address.toLowerCase() === claimedWallet.toLowerCase());
  } catch {
    return false;
  }
}

const readClient = createPublicClient({
  chain: celo,
  transport: fallback([
    http("https://forno.celo.org"),
    http("https://rpc.ankr.com/celo"),
  ]),
}) as PublicClient;

// The honest client posts within ~2 seconds of the mint landing. 30 minutes
// gave an attacker replaying a public tx hash a 30-minute window to race it;
// two minutes keeps every legitimate flow working (including a slow retry)
// while leaving almost no room to steal one.
const MINT_PROOF_MAX_AGE_MS = 2 * 60 * 1000;

/** WEAK proof — see the header. Replayable by anyone who reads the chain. */
export async function verifyRecentGamePassMint(
  wallet: string,
  txHash: string,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;
  try {
    const receipt = await readClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") return false;
    // The tx must be FROM the wallet being claimed — this is the actual proof
    // of key control — and TO the GamePass contract.
    if (receipt.from.toLowerCase() !== wallet.toLowerCase()) return false;
    if ((receipt.to ?? "").toLowerCase() !== CONTRACT_ADDRESSES.GAME_PASS.toLowerCase()) return false;

    const block = await readClient.getBlock({ blockNumber: receipt.blockNumber });
    const ageMs = Date.now() - Number(block.timestamp) * 1000;
    return ageMs >= 0 && ageMs <= MINT_PROOF_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const ALLOWED_ORIGINS = new Set([
  "https://gamearenahq.xyz",
  "https://www.gamearenahq.xyz",
]);

// Fail CLOSED, and note what this is for: Origin stops a BROWSER on another
// site (CSRF). It stops no script, because a script sets whatever Origin it
// likes. It is a layer, never the authentication.
//
// Two bugs lived here. The original `if (origin) { ...check... }` skipped the
// check entirely when the header was absent — and curl omits Origin by default.
// The replacement then accepted any `http://localhost:` origin in ALL
// environments, so `curl -H 'Origin: http://localhost:1'` sailed through
// production. Dev origins are now gated on the environment.
export function originAllowed(req: Request): boolean {
  const devOk = process.env.NODE_ENV !== "production";
  const origin = req.headers.get("origin");
  if (!origin) return devOk;
  if (devOk && (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin))) {
    return true;
  }
  return ALLOWED_ORIGINS.has(origin);
}
