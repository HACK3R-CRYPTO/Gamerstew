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
  const { ready, authed } = useAuthStatus();

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

// Same auth signal as useRequireAuth but WITHOUT the redirect. For
// free-play routes: guests may enter and play, and the page decides
// at the action layer (score save, leaderboard) what needs a session.
export function useAuthStatus(): { ready: boolean; authed: boolean; pending: boolean } {
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();

  // "Authed" = has an actual wallet address AND a valid session. Just
  // checking Privy's `authenticated` was a footgun: a player can stay
  // Privy-authenticated long after they disconnect their wallet, which
  // let them walk back into a game with no wallet to sign txs.
  // Requiring `address` closes that gap — no wallet, no entry. MiniPay
  // users are also covered: their address is always set in-app.
  const authed = !!address && (authenticated || isMiniPay);
  // Privy session exists but wagmi hasn't resolved the wallet yet — a
  // loading state, NOT a guest state. Callers use this to avoid flashing
  // guest UI at signed-in players during hydration.
  const pending = authenticated && !address;

  return { ready, authed, pending };
}
