"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";

// Single auth gate for protected routes. Redirects to /connect when the
// visitor has no usable wallet session (no Privy auth AND no MiniPay
// auto-connect). next= carries the current URL so the connect flow
// brings them back where they wanted to go.
//
// Routes that need this: anything that takes a user-bound action —
// /profile, /verify (already has it), /mint (already has it), every
// /games/* gameplay page. Pages that should NOT use it (public
// browsing): /home, /games lobby, /leaderboard, /pitch, /terms,
// /privacy. Mixed pages (read public, action gated) stay public and
// gate at the action handler.
//
// Returns a "ready" boolean callers can use to render a placeholder
// while Privy is still warming up — avoids flashing the page UI then
// yanking it away.
export function useRequireAuth(): { ready: boolean; authed: boolean } {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();

  // "Authed" = has a Privy session OR is inside MiniPay with an injected
  // wallet. MiniPay users never go through Privy.
  const authed = authenticated || (isMiniPay && !!address);

  useEffect(() => {
    if (!ready) return;
    if (authed) return;
    // Read the current URL from window directly. Using next/navigation's
    // useSearchParams here would force every consuming page into a
    // Suspense boundary just to render — overkill for an auth redirect
    // that only runs client-side anyway.
    if (typeof window === "undefined") return;
    const next = window.location.pathname + window.location.search;
    router.replace(`/connect?next=${encodeURIComponent(next)}`);
  }, [ready, authed, router]);

  return { ready, authed };
}
