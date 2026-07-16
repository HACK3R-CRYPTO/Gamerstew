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

const KEY = (id: number) => `gamearena:cosmetic:equipped:${id}`;
const EVENT = "gamearena:cosmetic-equip";

export function readEquipped(id: number): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(KEY(id));
  return v === null ? true : v === "1"; // default ON
}

export function writeEquipped(id: number, on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY(id), on ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, on } }));
}

// Reactive read + setter. SSR-safe: starts equipped, hydrates from storage on
// mount, and re-renders when the toggle flips anywhere (shop or another tab).
export function useEquipped(id: number): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);

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

  const set = useCallback((v: boolean) => { writeEquipped(id, v); setOn(v); }, [id]);
  return [on, set];
}
