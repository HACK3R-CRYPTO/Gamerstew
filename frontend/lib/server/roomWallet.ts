// Server only: imported by the rooms API route, never by a page.
import { PrivyClient } from "@privy-io/server-auth";

// ─── Which wallet is this player, really? ────────────────────────────────────
// A friend-room round a signed-in player finishes is recorded on the chain
// under their wallet. The browser cannot be taken at its word for which wallet
// that is, so this checks it the same way a solo run does:
//   Privy    the access token must be valid AND its linked wallet must be the
//            one claimed;
//   MiniPay  there is no token; the address is accepted as it is for solo runs
//            (app/actions/game.ts, startGameMiniPay), where the only thing a
//            liar gains is a server-checked score landing on someone else.
// Anything else plays as a guest: the round still counts in the room, it is
// just not recorded.

let privy: PrivyClient | null = null;
const client = () => (privy ??= new PrivyClient(process.env.NEXT_PUBLIC_PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!));

export async function checkedWallet(req: Request): Promise<string | null> {
  const claimed = req.headers.get("x-room-wallet") || "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(claimed)) return null;
  if (req.headers.get("x-room-minipay") === "1") return claimed.toLowerCase();
  const token = req.headers.get("x-room-auth") || "";
  if (!token) return null;
  try {
    const claims = await client().verifyAuthToken(token);
    const user = await client().getUser(claims.userId);
    const mine = user.linkedAccounts.some((a) => a.type === "wallet" && "address" in a && String(a.address).toLowerCase() === claimed.toLowerCase());
    return mine ? claimed.toLowerCase() : null;
  } catch {
    return null;
  }
}
