'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';
import { useAccount } from 'wagmi';

// Bridges Privy's wallet list into wagmi's active connector. @privy-io/wagmi
// does NOT activate a wallet in wagmi automatically after login — it relies
// on wagmi's reconnect cache from previous sessions. When that cache is gone
// (player revoked the site in their extension, cleared storage, first login
// on a device), login completes with authenticated=true but wagmi never gets
// an address: the app then treats the player as a guest and the auth reaper
// (useWalletAuthSync) eventually logs the session out. This component closes
// the loop: authenticated + wallets available + no wagmi address → activate
// the first wallet so `useAccount().address` populates.
export default function ActiveWalletSync() {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const attempting = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || address) return;
    const wallet = wallets[0];
    if (!wallet || attempting.current) return;
    attempting.current = true;
    setActiveWallet(wallet)
      .catch(() => {})
      .finally(() => {
        // Allow another attempt if the wallet list changes (e.g. the user
        // approves the extension prompt a few seconds later).
        setTimeout(() => { attempting.current = false; }, 1500);
      });
  }, [ready, authenticated, address, wallets, setActiveWallet]);

  return null;
}
