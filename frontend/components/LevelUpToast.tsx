"use client";

// ─── LevelUpCelebration ───────────────────────────────────────────────────────
// Full-screen staged reward moment — the kind you get in Brawl Stars,
// Clash Royale, Candy Crush, Monster Hunter. NOT a toast. A toast is
// a passive notification; this is a dopamine-hit interrupt that says
// "STOP, you just did something that matters."
//
// The sequence (senior-game-dev playbook):
//
//   Phase 1 (0→180ms)    BRIGHT FLASH wipe of the whole screen
//                        Gold radial burst, quick fade
//                        Audio sting fires on frame 1
//
//   Phase 2 (180→900ms)  Letters of "LEVEL UP!" slam in one at a time
//                        with a staggered scale-overshoot (110→90→105→
//                        100). Every letter has its own delay; they
//                        read like a drum fill.
//
//   Phase 3 (700ms+)     The big LV.N badge drops in with a heavier
//                        overshoot + rotation wobble, radial rays
//                        spinning behind it
//
//   Phase 4 (1400ms+)    Confetti particles drift downward (pure CSS
//                        keyframes — no RAF, no react state)
//                        Body copy appears, "TAP TO CONTINUE" pulse
//
// Dismiss at 3.6s or on tap. Haptic rumble on the drop. Audio is
// staggered too — primary sting at frame 1, achievement chime at the
// badge drop, so it sounds like a combo of stingers, not one flat beep.

import { useEffect, useRef } from "react";
import { playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import { useAudioSettings } from "@/hooks/useAudioSettings";

type Props = {
  level: number | null;
  onClose: () => void;
};

const LETTERS = ["L", "E", "V", "E", "L", " ", "U", "P", "!"];

export default function LevelUpToast({ level, onClose }: Props) {
  const playedForLevelRef = useRef<number | null>(null);
  const { hapticsOn } = useAudioSettings();

  useEffect(() => {
    if (level == null) {
      playedForLevelRef.current = null;
      return;
    }
    if (playedForLevelRef.current === level) return;
    playedForLevelRef.current = level;

    // Layered audio — sting on frame 1 (hits with the flash), chime
    // 650ms later (hits with the LV.N badge drop). Two stingers spaced
    // this way read as a combo cue, not a single beep.
    const stingT = setTimeout(() => playLevelUp(), 20);
    const chimeT = setTimeout(() => playAchievementChime(), 720);

    // Mobile haptic — quick tap-then-hold rhythm. Matches the flash +
    // letter cascade beat. Gated on the user's Haptics preference so
    // the Settings toggle is the single source of truth.
    if (hapticsOn && typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.([20, 30, 60]); } catch {}
    }

    const dismissT = setTimeout(() => onClose(), 3600);
    return () => {
      clearTimeout(stingT);
      clearTimeout(chimeT);
      clearTimeout(dismissT);
    };
  }, [level, onClose]);

  if (level == null) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(2,0,12,0.85)",
        backdropFilter: "blur(10px)",
        overflow: "hidden",
        cursor: "pointer", userSelect: "none",
        animation: "fadeIn 0.2s ease both",
      }}
    >
      {/* ── Phase 1: gold flash wipe ── */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(circle at 50% 50%, rgba(251,191,36,0.9) 0%, rgba(251,191,36,0.3) 20%, transparent 55%)",
        animation: "lvup-flash 0.55s ease-out both",
        pointerEvents: "none",
      }} />

      {/* ── Spinning rays behind the badge ── */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(88vmin, 620px)", height: "min(88vmin, 620px)",
        background: `conic-gradient(
          from 0deg,
          transparent 0deg, rgba(251,191,36,0.12) 6deg, transparent 18deg,
          transparent 40deg, rgba(251,191,36,0.12) 46deg, transparent 58deg,
          transparent 80deg, rgba(251,191,36,0.12) 86deg, transparent 98deg,
          transparent 120deg, rgba(251,191,36,0.12) 126deg, transparent 138deg,
          transparent 160deg, rgba(251,191,36,0.12) 166deg, transparent 178deg,
          transparent 200deg, rgba(251,191,36,0.12) 206deg, transparent 218deg,
          transparent 240deg, rgba(251,191,36,0.12) 246deg, transparent 258deg,
          transparent 280deg, rgba(251,191,36,0.12) 286deg, transparent 298deg,
          transparent 320deg, rgba(251,191,36,0.12) 326deg, transparent 338deg
        )`,
        animation: "lvup-rays 6s linear infinite, lvup-rays-in 0.7s ease-out 0.6s both",
        pointerEvents: "none",
        filter: "blur(1px)",
      }} />

      {/* ── Phase 2: letter cascade ── */}
      <div style={{
        position: "absolute",
        top: "28%", left: 0, right: 0,
        display: "flex", justifyContent: "center",
        gap: "clamp(2px, 0.8vw, 6px)",
        pointerEvents: "none",
      }}>
        {LETTERS.map((ch, i) => (
          <span key={i} style={{
            display: "inline-block",
            color: ch === " " ? "transparent" : "white",
            fontSize: "clamp(28px, 9vw, 56px)",
            fontWeight: 900, letterSpacing: "0.04em",
            lineHeight: 1,
            textShadow: "0 0 14px #fbbf24, 0 0 28px #f97316, 0 4px 8px rgba(0,0,0,0.8)",
            WebkitTextStroke: ch === " " ? "0" : "1.5px #fbbf24",
            transform: "translateY(-30px) scale(0.4)",
            opacity: 0,
            animation: ch === " " ? "none" : `lvup-letter-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) ${180 + i * 55}ms both`,
            minWidth: ch === " " ? "clamp(4px, 1.5vw, 10px)" : "auto",
          }}>{ch}</span>
        ))}
      </div>

      {/* ── Phase 3: LV.N badge drop-in ── */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        animation: "lvup-badge-in 0.8s cubic-bezier(0.34, 1.6, 0.64, 1) 0.65s both",
        pointerEvents: "none",
      }}>
        <div style={{
          padding: "clamp(20px, 5vw, 30px) clamp(34px, 8vw, 54px)",
          borderRadius: "28px",
          background: "linear-gradient(180deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)",
          border: "3px solid rgba(255,255,255,0.6)",
          boxShadow: "0 0 40px rgba(251,191,36,0.9), 0 0 80px rgba(251,191,36,0.5), 0 20px 40px rgba(0,0,0,0.6), inset 0 8px 18px rgba(255,255,255,0.7), inset 0 -6px 14px rgba(0,0,0,0.3)",
        }}>
          <div style={{
            color: "white",
            fontSize: "clamp(56px, 18vw, 96px)",
            fontWeight: 900, lineHeight: 0.9,
            letterSpacing: "0.02em",
            textShadow: "0 4px 0 #7c2d00, 0 6px 18px rgba(0,0,0,0.55), 0 0 30px rgba(255,255,255,0.4)",
            WebkitTextStroke: "2px #7c2d00",
            textAlign: "center",
          }}>
            LV.{level}
          </div>
        </div>
      </div>

      {/* ── Confetti rain — pure CSS, no RAF. 18 specks drifting from
          top of viewport through the center. Each has its own delay
          and horizontal position so it reads like a real shower. ── */}
      {Array.from({ length: 18 }).map((_, i) => {
        const palette = ["#fbbf24", "#f97316", "#c026d3", "#67e8f9", "#86efac", "#f472b6"];
        const color = palette[i % palette.length];
        const left = `${(i * 53) % 100}%`;
        const delay = 0.8 + (i % 6) * 0.15;
        const dur = 2.2 + ((i * 13) % 10) * 0.1;
        const size = 8 + (i % 4) * 3;
        return (
          <div key={i} style={{
            position: "absolute",
            top: "-20px", left,
            width: size, height: size * 1.8,
            background: color,
            borderRadius: "2px",
            boxShadow: `0 0 ${size}px ${color}`,
            animation: `lvup-confetti ${dur}s linear ${delay}s both`,
            pointerEvents: "none",
            opacity: 0,
          }} />
        );
      })}

      {/* ── Phase 4: sub-copy + CTA ── */}
      <div style={{
        position: "absolute",
        bottom: "clamp(20px, 10vh, 80px)", left: 0, right: 0,
        textAlign: "center",
        animation: "fadeIn 0.4s ease 1.7s both",
        pointerEvents: "none",
      }}>
        <div style={{
          color: "rgba(254,215,170,0.85)",
          fontSize: "clamp(12px, 3.4vw, 15px)",
          fontWeight: 800, letterSpacing: "0.08em",
          textShadow: "0 2px 6px rgba(0,0,0,0.7)",
        }}>
          You&apos;re now level {level}
        </div>
        <div style={{
          marginTop: "8px",
          color: "rgba(200,180,255,0.55)",
          fontSize: "clamp(9px, 2.6vw, 11px)",
          fontWeight: 700, letterSpacing: "0.18em",
          animation: "lvup-cta-pulse 1.4s ease-in-out infinite 2.2s",
        }}>
          TAP ANYWHERE TO CONTINUE
        </div>
      </div>
    </div>
  );
}
