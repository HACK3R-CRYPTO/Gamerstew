/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import toast from 'react-hot-toast';
import { useIdentitySDK, IdentitySDK } from '@goodsdks/identity-sdk';
import { ClaimSDK } from '@goodsdks/citizen-sdk';
type AnyIdentitySDK = any;

interface SelfVerificationContextType {
  isVerified: boolean;
  isVerifying: boolean;
  // Face-verification link + popup-blocked flag so surfaces can render a
  // same-tab fallback and unblock steps instead of an infinite spinner.
  fvLink: string | null;
  popupBlocked: boolean;
  verifyIdentity: () => Promise<void>;
  claimG$: () => Promise<void>;
  entitlement: bigint;
  cancelVerification: () => void;
  checkVerificationStatus: () => Promise<boolean>;
}

const SelfVerificationContext = createContext<SelfVerificationContextType | undefined>(undefined);

// Verified-flag cache. Whitelist status practically never revokes inside a
// week, so a cached "verified" is trustworthy enough to hydrate the UI
// instantly and to survive RPC hiccups (a failed status call must NOT flip
// a verified player back to unverified — that was the #1 "game doesn't
// recognize my verification" complaint).
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
function readVerifiedCache(address: string): boolean {
  try {
    const raw = localStorage.getItem(`gd_verified_${address.toLowerCase()}`);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    return cached?.verified === true && Date.now() - (cached.timestamp ?? 0) < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

export function SelfVerificationProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const identitySDK = useIdentitySDK('production');

  const [isVerified, setIsVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  // Face-verification link + popup-blocked flag — surfaced so /verify can
  // render a same-tab fallback and browser-specific unblock steps instead
  // of an infinite spinner.
  const [fvLink, setFvLink] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [entitlement, setEntitlement] = useState(0n);
  const hasCheckedRef = useRef(false);
  const lastAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setIsVerified(false);
      setEntitlement(0n);
      hasCheckedRef.current = false;
      lastAddressRef.current = null;
    }
  }, [isConnected]);

  const checkEntitlement = useCallback(async () => {
    if (!address || !publicClient || !identitySDK || !walletClient) return 0n;
    try {
      const claimSDK = new ClaimSDK({
        account: address,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK: identitySDK as AnyIdentitySDK,
        env: 'production',
      });
      const result = await claimSDK.checkEntitlement();
      setEntitlement(result.amount);
      return result.amount;
    } catch {
      return 0n;
    }
  }, [address, publicClient, walletClient, identitySDK]);

  const claimG$ = useCallback(async () => {
    if (!address || !publicClient || !walletClient || !identitySDK) {
      toast.error('Wallet not ready. Please try again.');
      return;
    }
    const toastId = toast.loading('Checking eligibility and claiming...');
    try {
      const claimSDK = new ClaimSDK({
        account: address,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK: identitySDK as AnyIdentitySDK,
        env: 'production',
      });
      await claimSDK.claim();
      toast.success('G$ claimed successfully!', { id: toastId });
      checkEntitlement();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to claim G$';
      toast.error(msg, { id: toastId });
    }
  }, [address, publicClient, walletClient, identitySDK, checkEntitlement]);

  const checkVerificationStatus = useCallback(async () => {
    if (!address || !publicClient || !identitySDK) {
      if (!address) setIsVerified(false);
      return false;
    }

    try {
      const claimSDK = new ClaimSDK({
        account: address,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK: identitySDK as AnyIdentitySDK,
        env: 'production',
      });
      const walletStatus = await claimSDK.getWalletClaimStatus();
      const verified = walletStatus.status !== 'not_whitelisted';
      setIsVerified(verified);
      hasCheckedRef.current = true;
      lastAddressRef.current = address;

      if (verified) {
        localStorage.setItem(
          `gd_verified_${address.toLowerCase()}`,
          JSON.stringify({ verified: true, timestamp: Date.now() })
        );
      }
      return verified;
    } catch (error) {
      console.error('GoodDollar verification check failed:', error);
      // A failed RPC call is "unknown", not "unverified". Fall back to
      // the cached flag so flaky networks can't strip a verified player.
      const cachedOk = readVerifiedCache(address);
      setIsVerified(cachedOk);
      return cachedOk;
    }
  }, [address, publicClient, walletClient, identitySDK]);

  // Hydrate from cache the moment an address lands — returning verified
  // players see their status instantly instead of waiting on (or losing
  // it to) the network round-trip below.
  useEffect(() => {
    if (address && readVerifiedCache(address)) setIsVerified(true);
  }, [address]);

  // Direct on-chain whitelist read — bypasses the GoodDollar SDK so a
  // missing walletClient (Privy still hydrating, external wallet not
  // yet ready, etc.) can't strand a verified player on "Verify to
  // unlock". Only depends on publicClient. Matches the SDK semantics:
  // a non-zero whitelistedRoot means whitelisted.
  useEffect(() => {
    if (!address || !publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        const root = await publicClient.readContract({
          address: "0xC361A6E67822a0EDc17D899227dd9FC50BD62F42",
          abi: [{
            inputs: [{ name: "account", type: "address" }],
            name: "getWhitelistedRoot",
            outputs: [{ name: "", type: "address" }],
            stateMutability: "view",
            type: "function",
          }] as const,
          functionName: "getWhitelistedRoot",
          args: [address],
        });
        if (cancelled) return;
        const verified = root !== "0x0000000000000000000000000000000000000000";
        if (verified) {
          setIsVerified(true);
          try {
            localStorage.setItem(
              `gd_verified_${address.toLowerCase()}`,
              JSON.stringify({ verified: true, timestamp: Date.now() })
            );
          } catch { /* localStorage unavailable */ }
        }
      } catch { /* fall through to SDK-based check below */ }
    })();
    return () => { cancelled = true; };
  }, [address, publicClient]);

  useEffect(() => {
    if (isConnected && address && identitySDK) {
      if (lastAddressRef.current !== address) hasCheckedRef.current = false;
      checkVerificationStatus();
    }
  }, [isConnected, address, identitySDK, walletClient]); // eslint-disable-line

  // Re-check when the tab regains focus — catches "verified in another
  // tab / the GoodDollar wallet" and returns with the badge already lit.
  // Only while unverified: once verified there's nothing to gain.
  useEffect(() => {
    if (!isConnected || !address || isVerified) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkVerificationStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isConnected, address, isVerified, checkVerificationStatus]);

  // Background poll while unverified — same cadence as the in-app
  // verifyIdentity poller but covers users who never tapped VERIFY here.
  // Stops as soon as the flag flips; one eth_call per tick.
  useEffect(() => {
    if (!isConnected || !address || !identitySDK || isVerified) return;
    const i = setInterval(checkVerificationStatus, 15000);
    return () => clearInterval(i);
  }, [isConnected, address, identitySDK, isVerified, checkVerificationStatus]);

  useEffect(() => {
    if (isConnected && identitySDK && address) {
      checkEntitlement();
      const interval = setInterval(checkEntitlement, 60000);
      return () => clearInterval(interval);
    }
  }, [isConnected, identitySDK, address]); // eslint-disable-line

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.isVerified === true || event.data?.success === true) {
        hasCheckedRef.current = false;
        await checkVerificationStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkVerificationStatus]);

  const verifyIdentity = useCallback(async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!identitySDK || !walletClient) {
      const waitId = toast.loading('Initializing GoodDollar SDK...');
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (identitySDK && walletClient) break;
      }
      toast.dismiss(waitId);
      if (!identitySDK || !walletClient) {
        const inMiniPay = typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay;
        toast.error(inMiniPay
          ? 'Could not start verification. Refresh the page and tap Verify again.'
          : 'Could not start verification. Refresh the page or reconnect your wallet, then try again.');
        return;
      }
    }

    setIsVerifying(true);
    const toastId = toast.loading('Generating Verification Link...');

    try {
      const idSDK = new IdentitySDK(publicClient as any, walletClient as any, 'production');
      const linkResult = await idSDK.generateFVLink(false, window.location.href, 42220);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalLink = typeof linkResult === 'string' ? linkResult : ((linkResult as any)?.link ?? '');

      toast.dismiss(toastId);
      if (finalLink) {
        setFvLink(finalLink);
        // Mobile browsers and in-wallet browsers (MiniPay) block or break
        // popups: the face scan runs in a stranded window, passes, but never
        // returns to finalize the on-chain whitelist — so the player looks
        // verified in the widget yet isWhitelisted stays false and they get
        // asked to verify again on next sign-in. On those clients, navigate
        // SAME-TAB. generateFVLink's callback (this page) returns the user
        // here, where the on-return / focus / poll checks re-read
        // getWhitelistedRoot and light the badge. Desktop keeps the popup.
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isMiniPay = typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay;
        const isMobile = /Android|iPhone|iPad|iPod|Mobile|MiniPay/i.test(ua);
        if (isMiniPay || isMobile) {
          toast('Opening Face Verification…', { icon: '👤' });
          window.location.href = finalLink; // page navigates away; returns via callback
          return;
        }
        toast('Opening GoodDollar Face Verification...', { icon: '👤' });
        // Desktop popup — with the popup-blocked fallback (same-tab link) below.
        const popup = window.open(finalLink, '_blank', 'width=800,height=800');
        setPopupBlocked(!popup);
      }

      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        hasCheckedRef.current = false;
        const verified = await checkVerificationStatus();
        if (verified) {
          clearInterval(pollInterval);
          setIsVerifying(false);
          toast.success('Identity Verified successfully!');
        }
        if (attempts >= 60) {
          clearInterval(pollInterval);
          setIsVerifying(false);
        }
      }, 5000);
    } catch {
      toast.error('Failed to start verification process', { id: toastId });
      setIsVerifying(false);
    }
  }, [isConnected, address, identitySDK, walletClient, publicClient, checkVerificationStatus]);

  const contextValue = useMemo(
    () => ({
      isVerified,
      isVerifying,
      fvLink,
      popupBlocked,
      verifyIdentity,
      claimG$,
      entitlement,
      cancelVerification: () => setIsVerifying(false),
      checkVerificationStatus,
    }),
    [isVerified, isVerifying, fvLink, popupBlocked, verifyIdentity, claimG$, entitlement, checkVerificationStatus]
  );

  return (
    <SelfVerificationContext.Provider value={contextValue}>
      {children}
    </SelfVerificationContext.Provider>
  );
}

export function useSelfVerification() {
  const context = useContext(SelfVerificationContext);
  if (context === undefined) {
    throw new Error('useSelfVerification must be used within a SelfVerificationProvider');
  }
  return context;
}
