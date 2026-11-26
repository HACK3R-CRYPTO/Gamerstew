"use client";

// Tells the server "this signed-in player has the app open", once a minute and
// only while the tab is visible. That is all a friend's green dot is made of.
// Guests send nothing.
//
// The same check-in keeps the player's own live line open (lib/ownLine.ts), so
// a friend's invite pops up on whatever screen they are on, the moment it is
// sent. The check-in's answer carries waiting invites as well, for a phone
// whose live line cannot open.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { asInvite, openOwnLine, type OwnInvite } from "@/lib/ownLine";
import { track } from "@/lib/track";
import InvitePopup from "@/components/InvitePopup";

// Invites this player has already answered (joined, closed, or let run out), so
// one is never shown twice. A fresh invite from the same friend is a new one.
const DONE_KEY = "gamearena:invites:done";
const key = (i: OwnInvite) => `${i.id}@${i.at}`;
function done(): string[] { try { const v = JSON.parse(window.localStorage.getItem(DONE_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } }
function markDone(i: OwnInvite) { try { window.localStorage.setItem(DONE_KEY, JSON.stringify([...done().filter((k) => k !== key(i)), key(i)].slice(-40))); } catch { /* private window: it may show once more */ } }

export default function Presence() {
  const { address: realAddress } = useAccount(); const { authenticated, getAccessToken } = usePrivy(); const realMiniPay = useIsMiniPay();
  const router = useRouter(); const pathname = usePathname();
  // a way to stand in as a player while testing on a developer's machine; never in the real app
  const test = process.env.NODE_ENV !== "production" && typeof window !== "undefined" ? (window as unknown as { __presenceWallet?: string }).__presenceWallet : undefined;
  const address = test ?? realAddress; const miniPay = realMiniPay || !!test;
  const ticket = useRef<string | null>(null);
  const [invite, setInvite] = useState<OwnInvite | null>(null);
  const showing = useRef<OwnInvite | null>(null);

  const offer = useCallback((list: OwnInvite[]) => {
    if (showing.current) return; // one at a time; the next check-in brings any other
    const answered = done(); const here = new URLSearchParams(window.location.search).get("room")?.toUpperCase();
    const next = [...list].sort((a, b) => b.at - a.at).find((i) => !answered.includes(key(i)) && i.code !== here);
    if (!next) return;
    showing.current = next; setInvite(next);
    track("invite_shown", { game: next.game });
    try { navigator.vibrate?.(40); } catch { /* not on this phone */ }
  }, []);
  const close = useCallback((why: "join" | "closed" | "ran_out") => {
    const i = showing.current; if (!i) return;
    markDone(i); showing.current = null; setInvite(null);
    track(why === "join" ? "invite_join" : why === "closed" ? "invite_closed" : "invite_ran_out", { game: i.game });
    if (why !== "join") return;
    // the same game's page is already open: load it again so it joins the room, as a typed link would
    if (pathname === i.url.split("?")[0]) window.location.assign(i.url); else router.push(i.url);
  }, [pathname, router]);

  useEffect(() => { if (!invite) return; const t = setTimeout(() => close("ran_out"), invite.left); return () => clearTimeout(t); }, [invite, close]);

  useEffect(() => {
    if (!address || !(miniPay || authenticated)) return;
    let stop = false;
    const ping = async () => {
      if (stop || document.visibilityState !== "visible") return;
      const who: Record<string, string> = miniPay ? { "x-room-wallet": address, "x-room-minipay": "1" } : { "x-room-wallet": address, "x-room-auth": (await getAccessToken().catch(() => null)) || "" };
      try {
        const r = await fetch("/api/friends/ping", { method: "POST", headers: { "content-type": "application/json", ...who }, body: "{}", keepalive: true });
        const d = r.ok ? await r.json().catch(() => null) : null;
        if (stop || !d) return;
        if (typeof d.ticket === "string") ticket.current = d.ticket;
        if (Array.isArray(d.invites)) offer(d.invites.map(asInvite).filter((i: OwnInvite | null): i is OwnInvite => !!i));
      } catch { /* the next check-in tries again */ }
    };
    void ping(); const t = setInterval(ping, 60000); document.addEventListener("visibilitychange", ping);
    const line = openOwnLine(() => ticket.current, { invite: (i) => offer([i]) });
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", ping); line.close(); ticket.current = null; };
  }, [address, authenticated, getAccessToken, miniPay, offer]);

  return invite ? <InvitePopup key={key(invite)} invite={invite} onJoin={() => close("join")} onClose={() => close("closed")} /> : null;
}
