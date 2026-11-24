"use client";

// Sends one page view each time the route changes, for every visitor, signed in
// or not. See lib/track.ts for what is and is not recorded.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";
import { isEmbedded } from "@/lib/vatar";
import { setTrackIdentity, track } from "@/lib/track";

export default function Track() {
  const pathname = usePathname();
  const { address } = useAccount();
  const miniPay = useIsMiniPay();
  const first = useRef(true);
  useEffect(() => { setTrackIdentity(address ?? null, miniPay ? "minipay" : isEmbedded() ? "vatar" : null); }, [address, miniPay]);
  useEffect(() => {
    if (!pathname) return;
    let ref: string | undefined;
    if (first.current) {
      first.current = false;
      // where they came from, on the first page of the visit only, and only the site's name
      try { const h = document.referrer ? new URL(document.referrer).hostname : ""; if (h && h !== window.location.hostname) ref = h; } catch { /* no referrer */ }
      const utm = new URLSearchParams(window.location.search).get("utm_source"); if (utm) ref = utm.slice(0, 60);
    }
    track("pageview", undefined, { ref });
  }, [pathname]);
  return null;
}
