"use client";

// ─── On-screen touch joystick ────────────────────────────────────────────────
// A DOM control (outside the Canvas) that feeds the SAME worldControls.input the
// keyboard writes, so the world is fully playable on a phone. Up on the stick =
// forward (negative z), matching the camera-relative controller in Player.tsx.
//
// The stick FLOATS: it is drawn resting at the bottom-left, but the whole lower
// left of the screen is its touch area, and it jumps to wherever the thumb
// lands. A fixed pad has to be found without looking and is in the wrong place
// for half of all hands; this one is always under the thumb (the layout Apple's
// game-control guidance recommends: a stick where the thumb lands for movement,
// the rest of the screen for turning the view). The right side of the screen is
// left alone for looking around and for tapping.
//
// A quick tap inside the stick's area that does not move still counts as the
// game's tap (flipping a breaker), so that half of the screen is not dead.

import { useCallback, useEffect, useRef, useState } from "react";
import { worldControls } from "./controls";

const KNOB_RATIO = 0.44;

export default function Joystick() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);
  const press = useRef({ x: 0, y: 0, t: 0, far: false });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  // where the pad is drawn, inside the zone: null = resting at the bottom-left
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // a pad sized for the screen: big enough for a thumb on a small phone, never huge on a tablet
  const [base, setBase] = useState(118);
  useEffect(() => {
    const fit = () => setBase(Math.round(Math.max(104, Math.min(136, window.innerWidth * 0.3))));
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const radius = base / 2, knobSize = Math.round(base * KNOB_RATIO);

  const setFromDelta = useCallback((dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, radius);
    const nx = len > 0 ? (dx / len) * clamped : 0;
    const ny = len > 0 ? (dy / len) * clamped : 0;
    setKnob({ x: nx, y: ny });
    // a small dead centre, so a resting thumb does not creep the character
    const dead = 0.12; const mag = clamped / radius; const live = mag < dead ? 0 : (mag - dead) / (1 - dead);
    worldControls.input.x = len > 0 ? (dx / len) * live : 0; // right +
    worldControls.input.z = len > 0 ? (dy / len) * live : 0; // down +, up (forward) -
  }, [radius]);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (pointerId.current !== null) return; // one thumb owns the stick
    const rect = zoneRef.current?.getBoundingClientRect();
    if (!rect) return;
    // the pad centres on the thumb, kept far enough from the edges to be drawn whole
    const cx = Math.max(rect.left + radius + 6, Math.min(rect.right - radius - 6, e.clientX));
    const cy = Math.max(rect.top + radius + 6, Math.min(rect.bottom - radius - 6, e.clientY));
    originRef.current = { x: cx, y: cy };
    setAt({ x: cx - rect.left, y: cy - rect.top });
    pointerId.current = e.pointerId;
    press.current = { x: e.clientX, y: e.clientY, t: performance.now(), far: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromDelta(e.clientX - cx, e.clientY - cy);
  }, [radius, setFromDelta]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId || !originRef.current) return;
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 12) press.current.far = true;
    setFromDelta(e.clientX - originRef.current.x, e.clientY - originRef.current.y);
  }, [setFromDelta]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    originRef.current = null;
    setKnob({ x: 0, y: 0 });
    setAt(null);
    worldControls.input.x = 0;
    worldControls.input.z = 0;
    // a quick tap that never moved is the game's tap, not a step
    if (e.type === "pointerup" && !press.current.far && performance.now() - press.current.t < 300) worldControls.actionTap = true;
  }, []);
  // never leave the character running if the page is hidden mid-drag
  useEffect(() => () => { worldControls.input.x = 0; worldControls.input.z = 0; }, []);

  return (
    <div
      ref={zoneRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label="Move"
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: "48%",
        height: "44%",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        zIndex: 20,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: at ? at.x - radius : "max(18px, env(safe-area-inset-left))",
          ...(at ? { top: at.y - radius } : { bottom: "calc(22px + env(safe-area-inset-bottom))" }),
          width: base,
          height: base,
          borderRadius: "50%",
          background: at ? "rgba(20,8,40,0.5)" : "rgba(20,8,40,0.32)",
          border: `1.5px solid rgba(255,255,255,${at ? 0.45 : 0.25})`,
          boxShadow: at ? "0 0 0 6px rgba(255,255,255,0.06)" : "none",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          pointerEvents: "none",
          transition: at ? "none" : "background .2s ease, border-color .2s ease",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: radius - knobSize / 2 + knob.x,
            top: radius - knobSize / 2 + knob.y,
            width: knobSize,
            height: knobSize,
            borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #ffd98a, #d9a441)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
        />
      </div>
    </div>
  );
}
