"use client";

// ─── Top-level mode routing for the 3D world ─────────────────────────────────
// The /world route is a multi-mode game sharing ONE street (buildings, cars,
// character, camera, lighting). This store only decides which mode is active:
//   "menu"    — the mode-select screen
//   "restore" — Restore the Light (bring the blackout back to life)
//   "charge"  — Charge Rush (the race-the-cut charging game)
// Each mode owns its own store + director + objects + HUD; this just switches.

import { create } from "zustand";

export type AppMode = "intro" | "menu" | "restore" | "charge";

interface AppStore {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  /** True while the mode lobby is open: the world is a backdrop, not playable. */
  lobby: boolean;
  setLobby: (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  mode: "menu",
  setMode: (mode) => set({ mode }),
  lobby: true,
  setLobby: (lobby) => set({ lobby }),
}));

// Dev-only: lets the headless harness jump straight into a mode for QA.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __appStore?: typeof useAppStore }).__appStore = useAppStore;
}
