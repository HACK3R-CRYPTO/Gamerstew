// ─── A ticket for a player's own line ────────────────────────────────────────
// A socket cannot pass through the site's server, so the phone connects to the
// game server itself. The game server has no way to check a sign-in on its own
// (that check lives on the site's server), so the site's server asks for a
// ticket on the player's behalf, after it has checked who they are, and hands
// it to the phone. The ticket says "this wallet, until this minute" and is
// signed with a key only this server has. It is short-lived and good for one
// thing: opening that player's own line. It can read nothing and move nothing.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TICKET_MS = 10 * 60_000;
const WALLET = /^0x[a-f0-9]{40}$/;

export function createTickets(secret: string, opts: { now?: () => number; ttlMs?: number } = {}) {
  // a key of its own, derived from the server's secret, so a ticket can never be mistaken for the secret itself
  const key = createHmac('sha256', secret).update('gamearena:own-line:v1').digest();
  const now = opts.now ?? Date.now; const ttl = opts.ttlMs ?? TICKET_MS;
  const mac = (body: string) => createHmac('sha256', key).update(body).digest();
  return {
    sign(wallet: string): string { const body = `${wallet.toLowerCase()}.${now() + ttl}`; return `${body}.${mac(body).toString('base64url')}`; },
    /** the wallet a ticket was made for, or null when it is forged, changed or out of date */
    verify(ticket: unknown): string | null {
      if (typeof ticket !== 'string' || ticket.length > 160) return null;
      const parts = ticket.split('.'); if (parts.length !== 3) return null;
      const [wallet, until, sig] = parts as [string, string, string];
      if (!WALLET.test(wallet) || !/^\d{13}$/.test(until)) return null;
      let given: Buffer; try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
      const want = mac(`${wallet}.${until}`);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
      return Number(until) > now() ? wallet : null;
    },
  };
}
export type Tickets = ReturnType<typeof createTickets>;
