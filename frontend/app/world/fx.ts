"use client";

// ─── Shared screen-flash signal ──────────────────────────────────────────────
// Directors call flash(perfect) on a big hit; World renders a brief full-screen
// vignette flash keyed on `key` (gold + brighter for a perfect). Kept tiny and
// separate so any mode can fire it.

import { create } from "zustand";

export type FxKind = "hit" | "shock";

interface Fx {
  key: number;
  big: boolean;
  kind: FxKind;
  flash: (big: boolean) => void;
  shock: () => void; // blue electric flash on a mistimed tap
}

export const useFx = create<Fx>((set) => ({
  key: 0,
  big: false,
  kind: "hit",
  flash: (big) => set((s) => ({ key: s.key + 1, big, kind: "hit" })),
  shock: () => set((s) => ({ key: s.key + 1, big: false, kind: "shock" })),
}));
