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

// ─── What graphics chip is this? ─────────────────────────────────────────────
// Not a guess from memory and core counts: the browser will say which graphics
// chip it is drawing with, and the chip is what decides how a 3D street runs.
// A phone with 8 GB and 8 cores can have a slow chip, and a phone that reports
// 4 cores can have a fast one (every iPhone does).
//
//   strong  Apple's chips, recent Snapdragon (Adreno 640 and up), recent
//           Mali flagship cores (G76 to G78, G610 and up), Samsung Xclipse
//   mid     Adreno 610 to 630, Mali G52, G57, G68, G71, G72
//   weak    older Adreno, Mali G31, G35, G51 and the T series, PowerVR
//           (the chip in most budget Tecno, Infinix and itel phones)
//
// Where the browser will not say, the answer is "unknown" and the older signs
// (memory, cores) are used. Either way this only picks where to START: the
// frame loop in Scene.tsx measures the real frame rate and adjusts from there.
export type Gpu = "strong" | "mid" | "weak" | "unknown";
export function gpuName(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext(); // do not hold a graphics context just for a name
    return name;
  } catch { return ""; }
}
export function gpuClass(name: string): Gpu {
  const n = name.toLowerCase();
  if (!n) return "unknown";
  if (/apple/.test(n)) return "strong";
  if (/xclipse/.test(n)) return "strong";
  const adreno = n.match(/adreno[^0-9]*(\d{3})/);
  if (adreno) { const v = Number(adreno[1]); return v >= 640 ? "strong" : v >= 610 ? "mid" : "weak"; }
  const mali = n.match(/mali-g(\d+)/);
  if (mali) { const v = Number(mali[1]); return v >= 600 || (v >= 76 && v <= 78) ? "strong" : v === 52 || v === 57 || v === 68 || v === 71 || v === 72 ? "mid" : "weak"; }
  if (/mali-t|powervr|img |sgx|vivante|videocore|swiftshader|llvmpipe/.test(n)) return "weak";
  if (/nvidia|geforce|radeon|rtx|gtx|intel\(r\) (iris|arc)/.test(n)) return "strong";
  return "unknown";
}

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
  // The graphics chip decides, where the browser names it. Only when it will not
  // do the older signs speak: an in-app browser or a phone short of memory starts low.
  const chip = mobile && !forced ? gpuClass(gpuName()) : "unknown";
  const byChip: Tier | null = chip === "strong" ? "mid" : chip === "mid" ? (inApp ? "low" : "mid") : chip === "weak" ? "low" : null;
  const tier: Tier =
    forced === "low" || forced === "mid" || forced === "high" ? forced : !mobile ? "high" : byChip ?? (apple ? "mid" : inApp || weak ? "low" : "mid");
  cached = { tier, mobile: forced ? tier !== "high" : mobile, ...TABLE[tier] };
  // a mid chip can draw the street sharply, and holds it better at a steady 30 to begin with
  if (!forced && chip === "mid" && tier === "mid") cached = { ...cached, dpr: 1.5, fps: 30 };
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") (window as unknown as { __quality?: unknown }).__quality = { ...cached, chip, gpu: mobile ? gpuName() : "" };
  return cached;
}
