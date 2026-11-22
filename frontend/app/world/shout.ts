"use client";

// ─── Pidgin callouts ─────────────────────────────────────────────────────────
// Short Naija shouts fired on game events (a PERFECT, a fumble, a combo streak,
// a win/loss). Kept punchy and authentic — the cultural flavour that makes this
// game unmistakably ours. Directors call shout(pick(LINES.x)); World renders a
// transient banner keyed on `key`.

import { create } from "zustand";

export const LINES = {
  perfect: ["Perfect gbam!", "Sharp sharp!", "No shaking!", "Mad o!", "Na you be this!"],
  good: ["Correct!", "You sabi!", "E make sense!", "On am!"],
  combo: ["You dey para!", "Fire fire!", "Back to back!", "E dey sweet you!"],
  miss: ["Ah ahn!", "Chai!", "You don miss am!", "Wetin happen?!", "No be so!"],
  shock: ["Chai! E shock me!", "Current catch me!", "NEPA shock o!", "Ah! E bite me!", "Weytin be dis!"],
  surge: ["Voltage dey drop!", "Light wan trip o!", "Hold am, e dey shake!", "NEPA dey vex!"],
  cut: ["NEPA don carry light!", "Dem don cut am again!", "Ahhh! e don trip!", "Light don go!"],
  traffic: ["Comot for road!", "Danfo jam me!", "Watch am now!", "Conductor dey craze!", "Chai! motor!"],
  win: ["You too much!", "Na champion be this!", "Baba oni light!", "Soft life activated!"],
  lose: ["NEPA win you this time.", "E no easy o.", "No vex, try again.", "You don enter darkness."],
} as const;

export function pick(arr: readonly string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type ShoutTone = "good" | "bad" | "big";

interface ShoutStore {
  key: number;
  text: string;
  tone: ShoutTone;
  shout: (text: string, tone?: ShoutTone) => void;
}

export const useShout = create<ShoutStore>((set) => ({
  key: 0,
  text: "",
  tone: "good",
  shout: (text, tone = "good") => set((s) => ({ key: s.key + 1, text, tone })),
}));
