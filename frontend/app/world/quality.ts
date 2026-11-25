// ─── Quality tiers ───────────────────────────────────────────────────────────
// One decision, made once, that every part of the world reads. A phone is not a
// small desktop: what costs it most is the number of separate things drawn, the
// number of lights every surface has to be shaded against, and animated
// characters. So each tier trades those away before it touches the look.
//
//   high  desktop / laptop: everything on
//   mid   a normal phone: no real-time lamp lights (the lamps still glow),
//         fewer pedestrians, each drawn in one piece
//   low   a budget phone, or any in-app browser (MiniPay, WhatsApp, Instagram,
//         TikTok, Facebook): those run inside a webview with less memory and a
//         slower graphics path, so they get the fewest people and 1x resolution
//
// Tune the numbers here, never inline in components.

export type Tier = "low" | "mid" | "high";

export interface Quality {
  tier: Tier;
  mobile: boolean;
  dpr: number; // the sharpest it may draw: device pixels per CSS pixel
  minDpr: number; // the softest it may fall to when the phone cannot keep up
  peds: number; // walking pedestrians
  propLights: boolean; // real point lights on lamps, lanterns, phones
  fps: number;
}

const TABLE: Record<Tier, Omit<Quality, "tier" | "mobile">> = {
  high: { dpr: 2, minDpr: 1.25, peds: 10, propLights: true, fps: 60 },
  // A phone screen has two to three device pixels per CSS pixel. Drawing at 1
  // was the "not sharp" complaint: every edge three times too coarse. Phones now
  // start at 2 and the frame governor (Scene.tsx) lowers that a step at a time
  // only if this phone cannot hold its frame rate.
  mid: { dpr: 2, minDpr: 1.25, peds: 6, propLights: false, fps: 60 },
  low: { dpr: 1.5, minDpr: 1, peds: 3, propLights: false, fps: 30 },
};

let cached: Quality | null = null;

export function quality(): Quality {
  if (cached) return cached;
  if (typeof navigator === "undefined") return { tier: "high", mobile: false, ...TABLE.high };
  const ua = navigator.userAgent;
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile|Touch/i.test(ua) ||
    (typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches);
  const inApp = /MiniPay|OPR\/|Opera Mini|FBAN|FBAV|FB_IAB|Instagram|WhatsApp|TikTok|musical_ly|Line\/|; wv\)/i.test(ua);
  const nav = navigator as Navigator & { deviceMemory?: number };
  // An iPhone or iPad always answers "4 cores" or fewer and gives no memory
  // figure, whatever chip it has, so those numbers say nothing about it. Every
  // iPhone that can run this site has a fast graphics chip: it is never "weak".
  const apple = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const weak = !apple && ((nav.deviceMemory ?? 8) <= 3 || (navigator.hardwareConcurrency ?? 8) <= 4);
  // ?q=low|mid|high forces a tier, for testing on any device
  const forced = typeof location !== "undefined" ? new URLSearchParams(location.search).get("q") : null;
  const tier: Tier =
    forced === "low" || forced === "mid" || forced === "high" ? forced : !mobile ? "high" : apple ? "mid" : inApp || weak ? "low" : "mid";
  cached = { tier, mobile: forced ? tier !== "high" : mobile, ...TABLE[tier] };
  return cached;
}
