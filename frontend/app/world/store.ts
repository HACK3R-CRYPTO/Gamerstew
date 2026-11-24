// ─── React-reactive world store (zustand) ───────────────────────────────────
// Only holds values that the React tree (HUD text, perf badge) needs to render.
// Hot per-frame values live in ./controls.ts instead, so this store updates at
// most a handful of times per NEPA cycle, never per frame.

import { create } from "zustand";
import type { NepaPhase } from "./controls";

export interface HudBanner {
  title: string;
  sub: string;
  /** "cut" tints the banner cold/blue, "relight" tints it warm/gold. */
  tone: "cut" | "relight" | "neutral";
  /** monotonically increasing so the HUD can re-trigger its flash animation. */
  key: number;
}

interface WorldStore {
  hud: HudBanner | null;
  phase: NepaPhase;
  /** Degrade-only flag: PerformanceMonitor sets it when the GPU falls behind. */
  lowPerf: boolean;
  /** 0 = full power on, 1 = full blackout. Mirrors (1 - lit), pushed by the
   *  director a few times per second only for the HUD power meter. */
  darkness: number;
  /** True while the player is driving a vehicle; the menu hides its cards so the
   *  free-roam view is clear. Set by DriveableKeke on enter/exit. */
  driving: boolean;
  setHud: (hud: HudBanner | null) => void;
  setPhase: (phase: NepaPhase) => void;
  setLowPerf: (v: boolean) => void;
  setDarkness: (v: number) => void;
  setDriving: (v: boolean) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  hud: null,
  phase: "on",
  lowPerf: false,
  darkness: 0,
  driving: false,
  setHud: (hud) => set({ hud }),
  setPhase: (phase) => set({ phase }),
  setLowPerf: (v) => set((s) => (s.lowPerf === v ? s : { lowPerf: v })),
  setDarkness: (v) => set({ darkness: v }),
  setDriving: (v) => set((s) => (s.driving === v ? s : { driving: v })),
}));
