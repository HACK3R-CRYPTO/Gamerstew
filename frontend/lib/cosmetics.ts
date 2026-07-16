"use client";

// ─── Cosmetic equip state ─────────────────────────────────────────────────────
// Ownership of a cosmetic lives on-chain (PerkShop.ownsCosmetic). Whether an
// owned cosmetic is *currently applied* is a pure display preference with zero
// economic weight, so it lives in localStorage — no gas, no tx, instant toggle.
//
// Default: an owned cosmetic is EQUIPPED. Buying it should show the effect
// immediately (the reward is the skin). Players who want the stock look can
// toggle any cosmetic off; the choice persists and syncs live across the shop
// and any open game tab via a window event.

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getCosmeticEquip, setCosmeticEquip } from "@/app/actions/perks";

const KEY = (id: number) => `gamearena:cosmetic:equipped:${id}`;
const EVENT = "gamearena:cosmetic-equip";

// ── Account-map cache + in-flight dedupe ──────────────────────────────────────
// getCosmeticEquip is a server action (POST to the current route). Without this,
// every mount of every EquipToggle — and the shop remounts its cards on each
// wallet/block re-render — fired its own request, flooding the network tab.
// One shared 30s cache + a single in-flight promise means N toggles across the
// shop share ONE request, and remounts hit the cache instead of the server.
type EquipMap = Record<number, boolean>;
let mapCache: { addr: string; data: EquipMap; at: number } | null = null;
let mapInflight: { addr: string; p: Promise<EquipMap> } | null = null;
const CACHE_MS = 30_000;

async function loadEquipMap(address: string): Promise<EquipMap> {
  const now = Date.now();
  if (mapCache && mapCache.addr === address && now - mapCache.at < CACHE_MS) return mapCache.data;
  if (mapInflight && mapInflight.addr === address) return mapInflight.p;
  const p = getCosmeticEquip(address)
    .then(({ equipped }) => { mapCache = { addr: address, data: equipped, at: Date.now() }; return equipped; })
    .finally(() => { if (mapInflight && mapInflight.addr === address) mapInflight = null; });
  mapInflight = { addr: address, p };
  return p;
}

// Keep the cache coherent with a local toggle so other toggles don't re-fetch.
function patchCache(address: string, id: number, on: boolean) {
  if (mapCache && mapCache.addr === address) mapCache.data[id] = on;
}

export function readEquipped(id: number): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(KEY(id));
  return v === null ? true : v === "1"; // default ON
}

// Write to the local cache only (no event) — used when reconciling from the
// account so we don't echo a change back out to other listeners.
function cacheEquipped(id: number, on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY(id), on ? "1" : "0");
}

export function writeEquipped(id: number, on: boolean) {
  cacheEquipped(id, on);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, on } }));
  }
}

// Reactive read + setter. SSR-safe: starts equipped, hydrates from storage on
// mount, and re-renders when the toggle flips anywhere (shop or another tab).
export function useEquipped(id: number): [boolean, (on: boolean) => void] {
  const { address } = useAccount();

  // Read the local value SYNCHRONOUSLY on the first render (lazy init) so a
  // remount never flashes the default-on state before an effect corrects it.
  // The account value (below) then reconciles once the wallet is known.
  const [on, setOn] = useState(() => readEquipped(id));

  useEffect(() => {
    setOn(readEquipped(id));
    const onEvent = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: number; on: boolean } | undefined;
      if (d && d.id === id) setOn(d.on);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY(id)) setOn(readEquipped(id));
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, [id]);

  // Reconcile with the account. The wallet-keyed backend is the source of
  // truth across browsers/devices: if it has a choice, adopt it; if it has
  // none but this device holds an explicit OFF, migrate that choice up so it
  // isn't lost. Absence everywhere = default ON.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      const equipped = await loadEquipMap(address); // shared cache — no per-mount flood
      if (cancelled) return;
      if (id in equipped) {
        const v = equipped[id];
        cacheEquipped(id, v);
        setOn(v);
      } else if (readEquipped(id) === false) {
        patchCache(address, id, false);
        setCosmeticEquip(address, id, false); // migrate a pre-login local OFF
      }
    })();
    return () => { cancelled = true; };
  }, [address, id]);

  const set = useCallback((v: boolean) => {
    writeEquipped(id, v);
    setOn(v);
    if (address) {
      patchCache(address, id, v);
      setCosmeticEquip(address, id, v); // fire-and-forget account sync
    }
  }, [id, address]);

  return [on, set];
}
