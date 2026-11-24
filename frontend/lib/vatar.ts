"use client";

// ─── Vatar (Lagos Life) browser SDK wrapper ──────────────────────────────────
// Loads the official SDK once, inits it only when GameArena is EMBEDDED in a
// Vatar world, and turns a purchase into a server-confirmed delivery via the
// claimVatarPurchase server action (the secret stays on our server). Safe to
// call when NOT embedded: init no-ops and purchases report unavailable, so the
// standalone gamearenahq.xyz site is untouched.
//
// Identity: inside a Vatar world the player is the authenticated Vatar player.
// Vatar.init() returns { player: { id, name, avatar }, session } and our server
// verifies the session with POST /session/verify → playerId. No GameArena
// sign-in (Privy/Google) is involved — that flow can't even be framed.
//
// Usage once a product exists in the Vatar dashboard:
//   await initVatar();                        // on app load (embedded-only)
//   const r = await vatarPurchase("continue_run");
//   if (r.ok) { /* delivered + recorded server-side against the Vatar player */ }
// Docs: https://lagoslife.app/developers/docs

import { useSyncExternalStore } from "react";
import { claimVatarPurchase, ensureVatarOnchain } from "@/app/actions/vatar";

const SDK_SRC = "https://lagoslife.app/sdk/vatar-games-v1.js";

export type VatarPlayer = { id: string; name?: string; avatar?: string };
type VatarInit = { player: VatarPlayer; session: string; mode?: string };
type Purchase = { purchaseId: string; productId: string };
type Vatar = {
  init: () => Promise<VatarInit>;
  session: () => Promise<{ session: string }>;
  purchase: (productId: string) => Promise<Purchase>;
  purchases: () => Promise<Purchase[]>;
  onPurchase: (fn: (p: Purchase) => void) => void;
  // Vatar's OWN in-world leaderboard (Lagos Life). Separate from GameArena's
  // on-chain ladder. Optional — older SDK builds may not expose it.
  submitScore?: (score: number) => Promise<void> | void;
};

declare global {
  interface Window {
    Vatar?: Vatar;
  }
}

let sdkPromise: Promise<Vatar | null> | null = null;
let initPromise: Promise<VatarInit | null> | null = null;
let currentPlayer: VatarPlayer | null = null;
let currentWallet: string | undefined;
let currentVatarAddress: string | null = null; // custodial Celo wallet, lowercase

// Only embedded pages (inside an iframe, i.e. a Vatar world) should load/init
// the SDK; standalone gamearenahq.xyz never needs it.
export function isEmbedded(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true; // cross-origin frame access throws — we ARE framed
  }
}

// The authenticated Vatar player, once init has resolved (null until then / when
// not embedded).
export function getVatarPlayer(): VatarPlayer | null {
  return currentPlayer;
}

// React hook form of isEmbedded(). Returns false on the server and the first
// client render (so SSR + hydration match the standalone site), then the real
// value after mount. useSyncExternalStore is the hydration-safe way to read a
// client-only value — no setState-in-effect, no mismatch warning. Use it to
// hide standalone-only UI (sign-in prompts, nav) inside the embed.
const noopSubscribe = () => () => {};
export function useIsEmbedded(): boolean {
  return useSyncExternalStore(noopSubscribe, isEmbedded, () => false);
}

// Reactive custodial Celo address (lowercase) for the embedded Vatar player, or
// null. Populated when ensureVatarOnchain resolves; lets the leaderboard flag
// this player's own rows even though they have no browser wallet.
function subscribeVatarAddress(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("vatar:address", cb);
  return () => window.removeEventListener("vatar:address", cb);
}
export function useVatarAddress(): string | null {
  return useSyncExternalStore(subscribeVatarAddress, () => currentVatarAddress, () => null);
}

// Reactive Vatar display name, or undefined. Updates on the "vatar:player" event.
function subscribeVatarPlayer(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("vatar:player", cb);
  return () => window.removeEventListener("vatar:player", cb);
}
export function useVatarName(): string | undefined {
  return useSyncExternalStore(subscribeVatarPlayer, () => currentPlayer?.name, () => undefined);
}

function loadSdk(): Promise<Vatar | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Vatar) return Promise.resolve(window.Vatar);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SDK_SRC; // load from Vatar, never a copy — it gets security fixes
    s.async = true;
    s.onload = () => resolve(window.Vatar ?? null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return sdkPromise;
}

async function freshSession(): Promise<string | null> {
  const v = await loadSdk();
  if (!v) return null;
  try {
    return (await v.session()).session;
  } catch {
    return null;
  }
}

// A fresh Vatar session token, for server actions that need to verify the
// player server-side (e.g. recording a score on-chain). Null when not embedded.
export async function getVatarSession(): Promise<string | null> {
  if (!isEmbedded()) return null;
  return freshSession();
}

// Push a score to Vatar's OWN in-world leaderboard (Lagos Life). Separate from
// GameArena's on-chain ladder. Fire-and-forget and best-effort: no-ops when not
// embedded or when the SDK build has no submitScore. Vatar counts one score per
// ~20s, so callers submit once per finished run.
export async function vatarSubmitScore(score: number): Promise<void> {
  if (!isEmbedded()) return;
  if (!Number.isFinite(score) || score < 0) return;
  try {
    const v = await loadSdk();
    if (v?.submitScore) await v.submitScore(Math.round(score));
  } catch {
    /* in-world board is non-critical — ignore */
  }
}

// Confirm + deliver a purchase through our server. Errors are logged, not shown:
// an unclaimed purchase is retried on the next load via the pending sweep below.
async function claim(p: Purchase): Promise<{ ok?: boolean; productId?: string; error?: string } | undefined> {
  const session = (await freshSession()) ?? "";
  try {
    const r = await claimVatarPurchase(session, p.purchaseId, currentWallet);
    if (r?.error) console.warn("Vatar claim failed:", r.error);
    return r;
  } catch (e) {
    console.warn("Vatar claim threw:", e);
    return undefined;
  }
}

// Init the SDK and reconcile anything already paid for. Returns the player info,
// or null when not embedded / not a Vatar world. Idempotent (memoised).
export async function initVatar(wallet?: string): Promise<VatarInit | null> {
  currentWallet = wallet;
  if (!isEmbedded()) return null;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const v = await loadSdk();
    if (!v) return null;
    try {
      const info = await v.init();
      currentPlayer = info.player ?? null;
      // Let the UI (e.g. AppHeader) swap "Guest" for the real Vatar player as
      // soon as init resolves, without prop-drilling or polling.
      try {
        if (typeof window !== "undefined")
          window.dispatchEvent(new CustomEvent("vatar:player", { detail: currentPlayer }));
      } catch { /* no window / CustomEvent — ignore */ }
      // Bring this Vatar player onto Celo: the backend provisions a custodial
      // wallet and mints their GamePass (once). Fire-and-forget — gameplay never
      // waits on a chain write, and the backend is idempotent per player. Capture
      // the custodial address so the UI can recognise this player's own rows on
      // the leaderboard ("You · <Vatar name>").
      void ensureVatarOnchain(info.session)
        .then((r) => {
          if (r?.address) {
            currentVatarAddress = r.address.toLowerCase();
            try {
              if (typeof window !== "undefined")
                window.dispatchEvent(new CustomEvent("vatar:address", { detail: currentVatarAddress }));
            } catch { /* ignore */ }
          }
        })
        .catch(() => {});
      // Fires when a purchase is confirmed with no purchase() call waiting, e.g.
      // the player came back from a payment page.
      v.onPurchase((p) => {
        void claim(p);
      });
      // Deliver anything paid-for-but-not-delivered (a past claim that failed).
      try {
        const pending = await v.purchases();
        for (const p of pending || []) await claim(p);
      } catch {
        /* no pending, or not supported */
      }
      return info;
    } catch {
      return null; // not inside a Vatar world, or the SDK rejected init
    }
  })();
  return initPromise;
}

// Link (or update) the GameArena wallet used when recording future deliveries.
export function setVatarWallet(wallet?: string): void {
  currentWallet = wallet;
}

// Start a purchase: opens Vatar's pay sheet; resolves once payment is confirmed,
// then we claim it server-side. Returns { ok } and the productId on success.
export async function vatarPurchase(
  productId: string,
): Promise<{ ok: boolean; productId?: string; error?: string }> {
  const v = await loadSdk();
  if (!v) return { ok: false, error: "vatar_unavailable" };
  try {
    const p = await v.purchase(productId);
    const r = await claim(p);
    return { ok: !!r?.ok, productId: r?.productId, error: r?.error };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return { ok: false, error: code || "purchase_failed" };
  }
}
