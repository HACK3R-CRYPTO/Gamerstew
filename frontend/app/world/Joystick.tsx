"use client";

// ─── On-screen touch joystick (bottom-left) ──────────────────────────────────
// A small DOM control (outside the Canvas) that feeds the SAME worldControls.input
// the keyboard writes, so the world is fully playable on a phone. Pointer events
// cover touch + mouse. Up on the stick = forward (negative z), matching the
// camera-relative controller in Player.tsx.

import { useCallback, useRef, useState } from "react";
import { worldControls } from "./controls";

const BASE = 120; // px diameter of the pad
const RADIUS = BASE / 2;
const KNOB = 52;

export default function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const setFromDelta = useCallback((dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, RADIUS);
    const nx = len > 0 ? (dx / len) * clamped : 0;
    const ny = len > 0 ? (dy / len) * clamped : 0;
    setKnob({ x: nx, y: ny });
    worldControls.input.x = nx / RADIUS; // right +
    worldControls.input.z = ny / RADIUS; // down +, up (forward) -
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    originRef.current = { x: rect.left + RADIUS, y: rect.top + RADIUS };
    pointerId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromDelta(e.clientX - originRef.current.x, e.clientY - originRef.current.y);
  }, [setFromDelta]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId || !originRef.current) return;
    setFromDelta(e.clientX - originRef.current.x, e.clientY - originRef.current.y);
  }, [setFromDelta]);

  const onUp = useCallback((e: React.PointerEvent) => {
    if (pointerId.current !== e.pointerId) return;
    pointerId.current = null;
    originRef.current = null;
    setKnob({ x: 0, y: 0 });
    worldControls.input.x = 0;
    worldControls.input.z = 0;
  }, []);

  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: "absolute",
        left: "max(18px, env(safe-area-inset-left))",
        bottom: "calc(24px + env(safe-area-inset-bottom))",
        width: BASE,
        height: BASE,
        borderRadius: "50%",
        background: "rgba(20,8,40,0.35)",
        border: "1px solid rgba(255,255,255,0.25)",
        touchAction: "none",
        userSelect: "none",
        zIndex: 20,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: RADIUS - KNOB / 2 + knob.x,
          top: RADIUS - KNOB / 2 + knob.y,
          width: KNOB,
          height: KNOB,
          borderRadius: "50%",
          background: "radial-gradient(circle at 35% 30%, #ffd98a, #d9a441)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
