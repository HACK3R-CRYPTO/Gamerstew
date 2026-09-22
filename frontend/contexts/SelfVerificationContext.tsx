/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { celo } from 'viem/chains';
import toast from 'react-hot-toast';
import { IdentitySDK } from '@goodsdks/identity-sdk';
import { ClaimSDK } from '@goodsdks/citizen-sdk';

interface SelfVerificationContextType {
  isVerified: boolean;
  // False until the first whitelist read settles. Surfaces should render a
  // neutral/skeleton state while this is false rather than the "not verified"
  // state, otherwise a returning verified player sees VERIFY flash first.
  isVerificationResolved: boolean;
  // True when this wallet passed the face check before but its GoodDollar
  // identity has since expired. Surfaces MUST distinguish this from a player
  // who never verified — telling someone who verified last week to "verify to
  // unlock" reads as the app forgetting them.
  hasLapsed: boolean;
  // Countdown to the next required re-check. daysLeft is 0 when unknown.
  identityExpiry: { expiresAt: Date | null; daysLeft: number };
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

// ── Whitelist reads ─────────────────────────────────────────────────────────
// Every "is this wallet verified" read goes through this module-level client,
// pinned to Celo mainnet over plain HTTP. It deliberately does NOT use wagmi's
// usePublicClient()/useWalletClient():
//   * @goodsdks/identity-sdk's useIdentitySDK() builds a NEW IdentitySDK on
//     every render (no useMemo), so anything that takes it as a hook dependency
//     re-fires forever — which is what made the verified badge flicker.
//   * a wallet-bound client is undefined while Privy/MiniPay hydrate, and a
//     wallet parked on another chain reads the wrong contract.
// Reads are address-keyed and signature-free, so none of that is needed.
const GD_IDENTITY_CONTRACT = '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42' as const;

const GD_IDENTITY_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'getWhitelistedRoot',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'address' }],
    name: 'identities',
    outputs: [
      { name: 'dateAuthenticated', type: 'uint256' },
      { name: 'dateAdded', type: 'uint256' },
      { name: 'did', type: 'string' },
      { name: 'whitelistedOnChainId', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'authCount', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'reverifyDaysOptions',
    outputs: [{ name: '', type: 'uint32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'authenticationPeriod',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── How GoodDollar expiry ACTUALLY works (IdentityV4, verified on-chain) ────
// `authenticationPeriod()` is deprecated — the contract stores it as
// `unused_authenticationPeriod` and the getter just returns the LAST entry of
// `reverifyDaysOptions`. Real expiry is a graduated schedule:
//
//   isWhitelisted(a) = identities[a].status == 1
//                      && daysSince(dateAuthenticated) < reverifyDaysOptions[authCount]
//
// On Celo mainnet production `reverifyDaysOptions` is [3, 180]. So a player's
// FIRST-EVER verification (authCount 0) lapses after THREE DAYS; re-verifying
// bumps authCount to 1 and buys 180 days. Wallets authenticated before the
// LEGACY_AUTHCOUNT_CUTOFF upgrade are grandfathered onto the last step (180d).
//
// This is why players reported "I verified, two days later the app says I'm
// not verified" — it was never a client bug, their identity genuinely lapsed.
// We surface it as a re-verify prompt instead of pretending they never verified.
const LEGACY_AUTHCOUNT_CUTOFF = 1772697574; // 2026-03-05, the V4 upgrade point
const DAY_MS = 24 * 3600 * 1000;

const gdReadClient = createPublicClient({
  chain: celo,
  transport: fallback([
    http('https://forno.celo.org'),
    http('https://rpc.ankr.com/celo'),
    http('https://1rpc.io/celo'),
  ]),
}) as PublicClient;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error('GoodDollar identity read timed out')), ms);
    }),
  ]).finally(() => clearTimeout(t)) as Promise<T>;
}

export interface IdentitySnapshot {
  verified: boolean;
  // Has this wallet EVER been through the face check? Lets the UI say
  // "your check expired" instead of "verify to unlock" to someone who did.
  everVerified: boolean;
  // verified === false while everVerified === true.
  lapsed: boolean;
  expiresAt: Date | null;
  daysLeft: number;
}

// Returns null on an unreadable chain — NOT a negative. A flaky RPC must never
// be reported as "unverified"; that is what used to strip the badge off
// verified players mid-session.
async function readIdentity(address: `0x${string}`): Promise<IdentitySnapshot | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [root, identity] = await withTimeout(
        Promise.all([
          gdReadClient.readContract({
            address: GD_IDENTITY_CONTRACT,
            abi: GD_IDENTITY_ABI,
            functionName: 'getWhitelistedRoot',
            args: [address],
          }),
          gdReadClient.readContract({
            address: GD_IDENTITY_CONTRACT,
            abi: GD_IDENTITY_ABI,
            functionName: 'identities',
            args: [address],
          }),
        ]),
        12000,
      );

      // getWhitelistedRoot is the authority: it is isWhitelisted(account), and
      // additionally resolves a wallet the player LINKED to their identity.
      const verified = root !== ZERO_ADDRESS;
      const [dateAuthenticated, , , , status, authCount] = identity;
      const everVerified = Number(status) === 1 || dateAuthenticated > 0n;

      let expiresAt: Date | null = null;
      if (dateAuthenticated > 0n) {
        const authedAtMs = Number(dateAuthenticated) * 1000;
        const legacy = Number(dateAuthenticated) < LEGACY_AUTHCOUNT_CUTOFF;
        const windowDays = await readReverifyWindowDays(legacy ? null : Number(authCount));
        if (windowDays !== null) expiresAt = new Date(authedAtMs + windowDays * DAY_MS);
      }

      const daysLeft = expiresAt
        ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS))
        : 0;

      return { verified, everVerified, lapsed: everVerified && !verified, expiresAt, daysLeft };
    } catch (err) {
      if (attempt === 1) console.warn('[GoodDollar] identity read failed:', err);
    }
  }
  return null;
}

// reverifyDaysOptions[authCount], falling back to authenticationPeriod() — which
// is the LAST step of the schedule, and so is also the right answer for legacy
// (grandfathered) wallets. Cached per step; the schedule is governance-set and
// effectively static.
const reverifyWindowCache = new Map<number | 'last', number>();
async function readReverifyWindowDays(authCount: number | null): Promise<number | null> {
  const key = authCount === null ? 'last' : authCount;
  const hit = reverifyWindowCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const days =
      authCount === null
        ? Number(
            await gdReadClient.readContract({
              address: GD_IDENTITY_CONTRACT,
              abi: GD_IDENTITY_ABI,
              functionName: 'authenticationPeriod',
            }),
          )
        : Number(
            await gdReadClient.readContract({
              address: GD_IDENTITY_CONTRACT,
              abi: GD_IDENTITY_ABI,
              functionName: 'reverifyDaysOptions',
              args: [BigInt(authCount)],
            }),
          );
    reverifyWindowCache.set(key, days);
    return days;
  } catch {
    // Out-of-bounds authCount (schedule shortened by governance) or a bad read.
    // Not worth failing the whole snapshot over — we just lose the countdown.
    return null;
  }
}

// Verified-flag cache, used ONLY to hydrate the first paint so returning
// players don't see the unverified state flash. The live read above is always
// authoritative and corrects it within a beat.
//
// It stores the real on-chain expiry rather than a fixed TTL: a first-time
// verifier lapses in 3 days, so a naive 7-day cache would keep claiming
// "verified" for days after GoodDollar stopped agreeing.
const cacheKey = (address: string) => `gd_verified_${address.toLowerCase()}`;

function readVerifiedCache(address: string): boolean {
  try {
    const raw = localStorage.getItem(cacheKey(address));
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (cached?.verified !== true) return false;
    // Older entries (written before expiry tracking) carry no expiresAt; give
    // them the shortest schedule step so they can't outlive a real lapse.
    const expiresAt = cached.expiresAt ?? (cached.timestamp ?? 0) + 3 * DAY_MS;
    return Date.now() < expiresAt;
  } catch {
    return false;
  }
}

function writeVerifiedCache(address: string, snap: IdentitySnapshot) {
  try {
    if (snap.verified) {
      localStorage.setItem(
        cacheKey(address),
        JSON.stringify({
          verified: true,
          timestamp: Date.now(),
          expiresAt: snap.expiresAt ? snap.expiresAt.getTime() : Date.now() + 3 * DAY_MS,
        }),
      );
    } else {
      localStorage.removeItem(cacheKey(address));
    }
  } catch {
    /* private mode / storage disabled */
  }
}

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function SelfVerificationProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [isVerified, setIsVerified] = useState(false);
  const [isVerificationResolved, setIsVerificationResolved] = useState(false);
  const [hasLapsed, setHasLapsed] = useState(false);
  const [identityExpiry, setIdentityExpiry] = useState<{ expiresAt: Date | null; daysLeft: number }>({
    expiresAt: null,
    daysLeft: 0,
  });
  const [isVerifying, setIsVerifying] = useState(false);
  // Face-verification link + popup-blocked flag — surfaced so /verify can
  // render a same-tab fallback and browser-specific unblock steps instead
  // of an infinite spinner.
  const [fvLink, setFvLink] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [entitlement, setEntitlement] = useState(0n);

  // Monotonic generation guard: only the newest in-flight read for the newest
  // address is allowed to write state, so overlapping polls can't land out of
  // order and toggle the badge.
  const genRef = useRef(0);
  const addressRef = useRef<string | undefined>(undefined);

  // Signing clients change identity on every wallet re-render; keep them in a
  // ref so they never feed a dependency array.
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;
  const publicClientRef = useRef(publicClient);
  publicClientRef.current = publicClient;

  // ── The single writer of isVerified ───────────────────────────────────────
  // Nothing else in this provider is allowed to call setIsVerified. Every
  // trigger (mount, focus, poll, post-verify) funnels through here, which is
  // what removes the true/false race between competing effects.
  const checkVerificationStatus = useCallback(async (): Promise<boolean> => {
    const target = addressRef.current as `0x${string}` | undefined;
    if (!target) return false;

    const gen = ++genRef.current;
    const snap = await readIdentity(target);

    // A newer check (or an address change) superseded this one.
    if (gen !== genRef.current || addressRef.current !== target) return false;

    if (snap === null) {
      // Unknown, not negative. Hold whatever we already believe.
      setIsVerificationResolved(true);
      return readVerifiedCache(target);
    }

    setIsVerified(snap.verified);
    setHasLapsed(snap.lapsed);
    setIdentityExpiry({ expiresAt: snap.expiresAt, daysLeft: snap.daysLeft });
    setIsVerificationResolved(true);
    writeVerifiedCache(target, snap);
    return snap.verified;
  }, []);

  // Hydrate from cache before paint the moment an address lands, so returning
  // verified players never see the unverified state flash.
  //
  // Keyed on wagmi's `status`, not `isConnected`: on a hard refresh (and every
  // MiniPay cold start) wagmi passes through `connecting`/`reconnecting` with
  // isConnected=false and address=undefined for a beat. Treating that as
  // "disconnected" would wipe the flag and blink the badge off on every load.
  // Only a settled `disconnected` clears state.
  useIsomorphicLayoutEffect(() => {
    if (status === 'connecting' || status === 'reconnecting') return; // still settling — hold

    addressRef.current = address;
    genRef.current++; // invalidate any read still in flight for the old address

    if (status === 'disconnected' || !address) {
      setIsVerified(false);
      setIsVerificationResolved(false);
      setHasLapsed(false);
      setIdentityExpiry({ expiresAt: null, daysLeft: 0 });
      setEntitlement(0n);
      return;
    }

    const cached = readVerifiedCache(address);
    setIsVerified(cached);
    setHasLapsed(false); // unknown until the live read lands
    setIsVerificationResolved(cached); // a cache hit is good enough to render
  }, [address, status]);

  // Live on-chain read on address change. Depends on the address alone — no
  // SDK instance, no wallet client — so it runs once per wallet, not per render.
  useEffect(() => {
    if (!isConnected || !address) return;
    void checkVerificationStatus();
  }, [address, isConnected, checkVerificationStatus]);

  // Re-check when the tab regains focus — catches "verified in another
  // tab / the GoodDollar wallet" and returns with the badge already lit.
  // Only while unverified: once verified there's nothing to gain.
  useEffect(() => {
    if (!isConnected || !address || isVerified) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVerificationStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isConnected, address, isVerified, checkVerificationStatus]);

  // Background poll while unverified — this is what lights the badge after a
  // face check completes in another tab. Stops as soon as the flag flips.
  useEffect(() => {
    if (!isConnected || !address || isVerified) return;
    const i = setInterval(() => void checkVerificationStatus(), 15000);
    return () => clearInterval(i);
  }, [isConnected, address, isVerified, checkVerificationStatus]);

  // Once verified, re-read hourly. A first-time verification is only good for
  // three days, so a long-lived session (MiniPay tabs live for days) has to
  // notice the lapse rather than show a stale green badge until reload.
  useEffect(() => {
    if (!isConnected || !address || !isVerified) return;
    const i = setInterval(() => void checkVerificationStatus(), 60 * 60 * 1000);
    return () => clearInterval(i);
  }, [isConnected, address, isVerified, checkVerificationStatus]);

  // Face-verification popup posts back on success.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.isVerified === true || event.data?.success === true) {
        void checkVerificationStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkVerificationStatus]);

  // ── Claim / entitlement ───────────────────────────────────────────────────
  // ClaimSDK needs a signing wallet client, so unlike the whitelist read this
  // does depend on the wallet. It never touches isVerified.
  const buildClaimSDK = useCallback((): ClaimSDK | null => {
    const wc = walletClientRef.current;
    const pc = publicClientRef.current;
    if (!address || !wc || !pc) return null;
    const identitySDK = new IdentitySDK(pc as any, wc as any, 'production');
    return new ClaimSDK({
      account: address,
      publicClient: pc as any,
      walletClient: wc as any,
      identitySDK: identitySDK as any,
      env: 'production',
    });
  }, [address]);

  const checkEntitlement = useCallback(async () => {
    try {
      const claimSDK = buildClaimSDK();
      if (!claimSDK) return 0n;
      const result = await claimSDK.checkEntitlement();
      setEntitlement(result.amount);
      return result.amount;
    } catch {
      return 0n;
    }
  }, [buildClaimSDK]);

  const claimG$ = useCallback(async () => {
    const claimSDK = buildClaimSDK();
    if (!claimSDK) {
      toast.error('Wallet not ready. Please try again.');
      return;
    }
    const toastId = toast.loading('Checking eligibility and claiming...');
    try {
      await claimSDK.claim();
      toast.success('G$ claimed successfully!', { id: toastId });
      void checkEntitlement();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to claim G$';
      toast.error(msg, { id: toastId });
    }
  }, [buildClaimSDK, checkEntitlement]);

  // Entitlement refresh only matters once the player is actually verified.
  useEffect(() => {
    if (!isConnected || !address || !isVerified) return;
    void checkEntitlement();
    const interval = setInterval(() => void checkEntitlement(), 60000);
    return () => clearInterval(interval);
  }, [isConnected, address, isVerified, checkEntitlement]);

  const verifyIdentity = useCallback(async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet first');
      return;
    }

    // The FV link is signed by the player's wallet, so here (unlike the read
    // path) we genuinely have to wait for the wallet client to hydrate.
    let wc = walletClientRef.current;
    if (!wc) {
      const waitId = toast.loading('Initializing GoodDollar SDK...');
      for (let i = 0; i < 12 && !wc; i++) {
        await new Promise((r) => setTimeout(r, 500));
        wc = walletClientRef.current;
      }
      toast.dismiss(waitId);
      if (!wc) {
        const inMiniPay = typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay;
        toast.error(
          inMiniPay
            ? 'Could not start verification. Refresh the page and tap Verify again.'
            : 'Could not start verification. Refresh the page or reconnect your wallet, then try again.',
        );
        return;
      }
    }

    setIsVerifying(true);
    const toastId = toast.loading('Generating Verification Link...');

    try {
      const idSDK = new IdentitySDK(publicClientRef.current as any, wc as any, 'production');
      const linkResult = await idSDK.generateFVLink(false, window.location.href, 42220);
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
  }, [isConnected, address, checkVerificationStatus]);

  const contextValue = useMemo(
    () => ({
      isVerified,
      isVerificationResolved,
      hasLapsed,
      identityExpiry,
      isVerifying,
      fvLink,
      popupBlocked,
      verifyIdentity,
      claimG$,
      entitlement,
      cancelVerification: () => setIsVerifying(false),
      checkVerificationStatus,
    }),
    [
      isVerified,
      isVerificationResolved,
      hasLapsed,
      identityExpiry,
      isVerifying,
      fvLink,
      popupBlocked,
      verifyIdentity,
      claimG$,
      entitlement,
      checkVerificationStatus,
    ],
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
