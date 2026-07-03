'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useSetActiveWallet } from '@privy-io/wagmi';
import { useAccount, useDisconnect } from 'wagmi';

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
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const attempting = useRef(false);

  // Eviction half of the identity rule: if an extension player's active
  // wagmi connection is the EMBEDDED wallet (a leftover from wagmi's
  // reconnect cache or an old auto-attach), drop it. Being signed in as
  // the embedded wallet means an empty stranger account — no GamePass, no
  // history. Dropping the address surfaces the honest reconnect banner.
  useEffect(() => {
    if (!ready || !authenticated || !address) return;
    const hasExternalLinked = (user?.linkedAccounts ?? []).some(
      (a) => a.type === 'wallet' && (a as { walletClientType?: string }).walletClientType !== 'privy',
    );
    if (!hasExternalLinked) return;
    const active = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
    if (active?.walletClientType === 'privy') {
      disconnectAsync().catch(() => {});
    }
  }, [ready, authenticated, address, wallets, user, disconnectAsync]);

  useEffect(() => {
    if (!ready || !authenticated || address) return;

    // Identity rule: NEVER silently swap identities. A player who signed in
    // with an external wallet (Rabby/MetaMask) IS that address — their
    // GamePass, ladder rank and history live there. If their extension
    // disconnects, falling back to the auto-created embedded wallet would
    // quietly log them in as a different account. So:
    //   · external wallet connected & in the list → re-attach it
    //   · only embedded exists AND the user has no external wallet linked
    //     (Google/email player) → attach the embedded one
    //   · external linked but disconnected → do NOTHING; the /connect page
    //     shows the honest banner with reconnect / log out choices.
    const hasExternalLinked = (user?.linkedAccounts ?? []).some(
      (a) => a.type === 'wallet' && (a as { walletClientType?: string }).walletClientType !== 'privy',
    );
    const external = wallets.find((w) => w.walletClientType !== 'privy');
    const embedded = wallets.find((w) => w.walletClientType === 'privy');
    const wallet = external ?? (!hasExternalLinked ? embedded : undefined);

    if (!wallet || attempting.current) return;
    attempting.current = true;
    setActiveWallet(wallet)
      .catch(() => {})
      .finally(() => {
        // Allow another attempt if the wallet list changes (e.g. the user
        // approves the extension prompt a few seconds later).
        setTimeout(() => { attempting.current = false; }, 1500);
      });
  }, [ready, authenticated, address, wallets, user, setActiveWallet]);

  return null;
}
