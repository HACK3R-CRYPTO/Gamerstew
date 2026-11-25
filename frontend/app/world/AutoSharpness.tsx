"use client";

// ─── Sharpness that fits the phone, for any 3D game ──────────────────────────
// Put this inside a <Canvas>. It starts the picture at the level the device
// check chose (quality.ts: read the graphics chip, or the player's own choice),
// then watches the real frame rate. Well under 45 for four seconds: one step
// softer. Easily over 55 for six: one step sharper. A level that proved too much
// is not tried again. After twenty seconds it remembers where it settled and
// reports the device once, for the dashboard.
//
// UP NEPA 3D has its own frame loop and does the same thing there (Scene.tsx).
// This is the version for games that let the canvas run its own loop.

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { deviceFacts, quality, rememberSettled } from "./quality";
import { track } from "@/lib/track";

export default function AutoSharpness({ game }: { game: string }) {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ dpr: 0, top: 2, floor: 1, climb: true, frames: 0, ms: 0, slow: 0, quick: 0, tooMuch: Infinity, age: 0, windows: 0 });
  useEffect(() => {
    const q = quality(); const s = st.current; const screen = window.devicePixelRatio || 1;
    s.climb = q.climb; s.top = q.climb ? Math.min(2, screen) : Math.min(q.dpr, screen);
    s.dpr = Math.min(q.dpr, s.top); s.floor = Math.min(q.minDpr, s.dpr);
    setDpr(s.dpr);
  }, [setDpr]);
  useFrame((_, dt) => {
    const s = st.current; const ms = dt * 1000;
    if (!s.dpr || ms <= 0 || ms > 500) return; // a long gap is a hidden tab or a load, not a slow phone
    s.age += ms; if (s.age < 10000) return;    // loading stutters on any phone: a street of models takes a while to arrive
    s.frames++; s.ms += ms;
    if (s.ms < 2000) return;
    const fps = (s.frames * 1000) / s.ms; s.frames = 0; s.ms = 0; s.windows++;
    s.slow = fps < 43 ? s.slow + 1 : 0; s.quick = fps > 55 ? s.quick + 1 : 0;
    if (s.slow >= 2 && s.dpr > s.floor) { s.tooMuch = s.dpr; s.dpr = Math.max(s.floor, s.dpr - 0.25); setDpr(s.dpr); s.slow = 0; s.quick = 0; }
    else if (s.quick >= 3 && s.dpr + 0.25 <= s.top && s.dpr + 0.25 < s.tooMuch) { s.dpr += 0.25; setDpr(s.dpr); s.quick = 0; }
    if (s.windows === 10) { if (s.climb) rememberSettled(s.dpr, fps >= 43 ? 60 : 30); track("device_profile", { ...deviceFacts(), game, settled_dpr: s.dpr, got_fps: Math.round(fps) }); }
  });
  return null;
}
