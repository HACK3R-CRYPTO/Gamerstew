"use client";

// ─── useFriends ──────────────────────────────────────────────────────────────
// A signed-in player's friends: the list, requests in and out, and the four
// things they can do (ask, accept, remove, invite into a room). Guests get an
// empty list and `signedIn: false`.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";

export interface Found { wallet: string; name: string | null; state: "none" | "asked" | "incoming" | "friends" }
export interface Friend { wallet: string; name: string | null; since: string; online?: boolean; lastSeen?: number | null }
/** "Online", "Active 5m ago", or nothing when it is not known */
export function seenLabel(f: Friend, nowMs = Date.now()): string {
  if (f.online) return "Online";
  if (!f.lastSeen) return "";
  const m = Math.max(1, Math.round((nowMs - f.lastSeen) / 60000));
  return m < 60 ? `Active ${m}m ago` : m < 1440 ? `Active ${Math.round(m / 60)}h ago` : `Active ${Math.round(m / 1440)}d ago`;
}
const WORDS: Record<string, string> = {
  sign_in: "Sign in to use friends.", no_player: "No player has that name. Check the spelling, or ask them for their link.", yourself: "That is you.",
  full: "Your friends list is full (200).", too_many_asks: "You have many requests waiting. Let some be answered first.", not_friends: "You can only invite friends.",
  slow_down: "You just invited them. Give it a moment.", unavailable: "Friends are not available right now. Try again shortly.", unreachable: "Cannot reach the server. Check your connection.",
  not_yours: "Only they can accept that request.", no_request: "That request is no longer there.", bad_room: "Open a room first, then invite.",
};
export const explainFriends = (code: string) => WORDS[code] ?? "Something went wrong. Try again.";
export const friendLabel = (f: { name: string | null; wallet: string }) => (f.name ? `@${f.name}` : `${f.wallet.slice(0, 6)}…${f.wallet.slice(-4)}`);

export function useFriends() {
  const real = useAccount().address; const { authenticated: realAuth, getAccessToken, ready } = usePrivy(); const realMini = useIsMiniPay();
  // local development only: ?as=0x… looks at the page as that wallet (the build drops this in production)
  const [as, setAs] = useState<string | null>(null);
  useEffect(() => { if (process.env.NODE_ENV !== "production") { const a = new URLSearchParams(window.location.search).get("as") || ""; if (/^0x[0-9a-fA-F]{40}$/.test(a)) setAs(a); } }, []);
  const address = as ?? real; const miniPay = as ? true : realMini; const authenticated = realAuth;
  const signedIn = !!address && (miniPay || authenticated);
  const [friends, setFriends] = useState<Friend[]>([]); const [incoming, setIncoming] = useState<Friend[]>([]); const [outgoing, setOutgoing] = useState<Friend[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "guest" | "error">("loading");

  const call = useCallback(async (action: string, body?: unknown): Promise<Record<string, unknown>> => {
    if (!address) throw new Error("sign_in");
    const who: Record<string, string> = miniPay ? { "x-room-wallet": address, "x-room-minipay": "1" } : { "x-room-wallet": address, "x-room-auth": (await getAccessToken().catch(() => null)) || "" };
    let r: Response;
    try { r = await fetch(`/api/friends/${action}`, body === undefined ? { cache: "no-store", headers: who } : { method: "POST", headers: { "content-type": "application/json", ...who }, body: JSON.stringify(body) }); } catch { throw new Error("unreachable"); }
    const data = await r.json().catch(() => ({ error: "unreachable" }));
    if (!r.ok || data?.error) throw new Error(data?.error || "unreachable");
    return data;
  }, [address, getAccessToken, miniPay]);

  const refresh = useCallback(async () => {
    try { const d = await call("list"); setFriends((d.friends as Friend[]) ?? []); setIncoming((d.incoming as Friend[]) ?? []); setOutgoing((d.outgoing as Friend[]) ?? []); setState("ready"); }
    catch { setState("error"); }
  }, [call]);
  // keep the list fresh while the page is open, so a friend coming online shows up
  useEffect(() => {
    if (!signedIn) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    return () => clearInterval(t);
  }, [signedIn, refresh]);
  useEffect(() => {
    if (!ready && !miniPay) return;
    if (!signedIn) { setState("guest"); setFriends([]); setIncoming([]); setOutgoing([]); return; }
    void refresh();
  }, [ready, miniPay, signedIn, refresh]);

  // one function for the life of the sign-in: pages list it as an effect's dependency
  const search = useCallback(async (q: string): Promise<Found[]> => ((await call(`search?q=${encodeURIComponent(q)}`)).results as Found[]) ?? [], [call]);
  /** players with the app open right now, friends or not */
  const people = useCallback(async (): Promise<Found[]> => ((await call("people")).people as Found[]) ?? [], [call]);
  const act = useCallback(async (action: string, body: unknown) => { const d = await call(action, body); await refresh(); return d; }, [call, refresh]);
  return {
    signedIn, state, friends, incoming, outgoing, me: address?.toLowerCase() ?? null, refresh,
    ask: (to: string) => act("request", { to }),
    accept: (wallet: string) => act("accept", { wallet }),
    remove: (wallet: string) => act("remove", { wallet }),
    invite: (wallet: string, game: string, code: string) => call("invite", { wallet, game, code }),
    /** players to add, by the start of a name or a whole wallet */
    search, people,
  };
}
