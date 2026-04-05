'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import toast from 'react-hot-toast';
import { useIdentitySDK, IdentitySDK } from '@goodsdks/identity-sdk';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { ClaimSDK } from '@goodsdks/citizen-sdk';
type AnyIdentitySDK = any;

interface SelfVerificationContextType {
  isVerified: boolean;
  isVerifying: boolean;
  verifyIdentity: () => Promise<void>;
  claimG$: () => Promise<void>;
  entitlement: bigint;
  cancelVerification: () => void;
  checkVerificationStatus: () => Promise<boolean>;
}

const SelfVerificationContext = createContext<SelfVerificationContextType | undefined>(undefined);

export function SelfVerificationProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const identitySDK = useIdentitySDK('production');

  const [isVerified, setIsVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
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
    if (!isConnected || !address || !publicClient || !identitySDK) {
      setIsVerified(false);
      return false;
    }

    if (hasCheckedRef.current && lastAddressRef.current === address) {
      return isVerified;
    }

    const cached = localStorage.getItem(`gd_verified_${address.toLowerCase()}`);
    if (cached) {
      try {
        const { verified, timestamp } = JSON.parse(cached);
        if (verified && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
          setIsVerified(true);
          hasCheckedRef.current = true;
          lastAddressRef.current = address;
          return true;
        }
      } catch { /* ignore */ }
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
    } catch {
      setIsVerified(false);
      return false;
    }
  }, [isConnected, address, publicClient, walletClient, identitySDK, isVerified]);

  useEffect(() => {
    if (isConnected && address && identitySDK && lastAddressRef.current !== address) {
      hasCheckedRef.current = false;
      checkVerificationStatus();
    }
  }, [isConnected, address, identitySDK]); // eslint-disable-line

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
        toast.error('Could not initialize SDK. Try reconnecting your wallet.');
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
        toast('Opening GoodDollar Face Verification...', { icon: '👤' });
        window.open(finalLink, '_blank', 'width=800,height=800');
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
      verifyIdentity,
      claimG$,
      entitlement,
      cancelVerification: () => setIsVerifying(false),
      checkVerificationStatus,
    }),
    [isVerified, isVerifying, verifyIdentity, claimG$, entitlement, checkVerificationStatus]
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
