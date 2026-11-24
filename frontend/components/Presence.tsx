"use client";

// Tells the server "this signed-in player has the app open", once a minute and
// only while the tab is visible. That is all a friend's green dot is made of.
// Guests send nothing.

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { useIsMiniPay } from "@/hooks/useMiniPay";

export default function Presence() {
  const { address } = useAccount(); const { authenticated, getAccessToken } = usePrivy(); const miniPay = useIsMiniPay();
  useEffect(() => {
    if (!address || !(miniPay || authenticated)) return;
    let stop = false;
    const ping = async () => {
      if (stop || document.visibilityState !== "visible") return;
      const who: Record<string, string> = miniPay ? { "x-room-wallet": address, "x-room-minipay": "1" } : { "x-room-wallet": address, "x-room-auth": (await getAccessToken().catch(() => null)) || "" };
      void fetch("/api/friends/ping", { method: "POST", headers: { "content-type": "application/json", ...who }, body: "{}", keepalive: true }).catch(() => {});
    };
    void ping(); const t = setInterval(ping, 60000); document.addEventListener("visibilitychange", ping);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", ping); };
  }, [address, authenticated, getAccessToken, miniPay]);
  return null;
}
