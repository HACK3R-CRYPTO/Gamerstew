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
//
// Embedded wallets are explicitly excluded (`walletClientType === 'privy'`)
// because they don't have an extension to disconnect from in the first
// place, and the flicker would falsely log them out.
const DISCONNECT_DELAY_MS = 3000;

export function useWalletAuthSync(): void {
  const { authenticated, user, logout, ready } = usePrivy();
  const { address } = useAccount();
  const isMiniPay = useIsMiniPay();
  const walletType = user?.wallet?.walletClientType;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait for Privy to finish hydrating — `authenticated` reads false
    // for a beat on mount before the cookie is read, which would trigger
    // a spurious cleanup path.
    if (!ready) return;
    if (!authenticated) return;
    // Embedded-wallet users: never auto-logout. The Privy wallet has no
    // extension to disconnect from; an `address`-flicker during sign-in
    // is normal and shouldn't sign them out. MiniPay is in-app, also
    // can't be disconnected the way an extension can — exempt for the
    // same reason.
    if (!walletType || walletType === "privy") return;
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
  }, [ready, authenticated, address, walletType, isMiniPay, logout]);
}
