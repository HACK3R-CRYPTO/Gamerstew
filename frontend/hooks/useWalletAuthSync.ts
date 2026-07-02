"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useIsMiniPay } from "@/hooks/useMiniPay";

// Keeps the Privy session in sync with the underlying wallet's connection
// state. Privy auth lives independently of the wallet extension — that's
// correct for Privy-embedded wallets (Google / email sign-in) where no
// extension exists, but it surprises players who think "I disconnected
// Rabby, so I'm signed out." Without this, tapping "Sign in" again after
// disconnecting Rabby just pushes them back into the app because Privy
// still says authenticated=true.
//
// Heuristic: if the user is Privy-authed AND the wallet they linked is
// an EXTERNAL one (Rabby, MetaMask, WalletConnect, etc.) AND wagmi has
// reported `address` as undefined for more than DISCONNECT_DELAY_MS,
// drop the Privy session. The delay is a debounce — wagmi can briefly
// report no address during a chain switch or RPC hiccup, and a snap
// auto-logout there would be worse than the original UX gap.
const DISCONNECT_DELAY_MS = 5000;

export function useWalletAuthSync(): void {
  const { authenticated, logout, ready } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait for Privy to finish hydrating — `authenticated` reads false
    // for a beat on mount before the cookie is read, which would trigger
    // a spurious cleanup path.
    if (!ready) return;
    if (!authenticated) return;
    // MiniPay is in-app — its wallet can't be disconnected the way an
    // extension can, so never auto-logout there.
    //
    // NOTE: the old `walletType === "privy"` exemption was a bug. With
    // embeddedWallets createOnLogin: 'all-users', EVERY account has an
    // embedded wallet, so user.wallet often reads as "privy" even for
    // players who signed in with an extension — the reaper never fired
    // and extension-disconnected sessions lived forever as half-dead
    // "authenticated but Guest" states. The address is the truth: with
    // ActiveWalletSync now activating a wallet (embedded included)
    // right after login, any session that stays addressless for the
    // full delay is genuinely dead and should be reaped.
    if (isMiniPay) return;
    // Wallet still connected — clear any pending logout and bail.
    if (address) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      return;
    }
    // External wallet, Privy still authed, no address from wagmi → schedule
    // the auto-logout. Cleared on unmount or if the address comes back.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try { await logout(); } catch { /* best-effort */ }
    }, DISCONNECT_DELAY_MS);
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [ready, authenticated, address, isMiniPay, logout]);
}
