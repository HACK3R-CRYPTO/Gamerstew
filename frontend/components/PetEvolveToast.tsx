"use client";

// ─── PetEvolutionCelebration ─────────────────────────────────────────────────
// Bigger hero moment than level-up. Pokemon-style. The pet is the star —
// it gets a silhouette flash, the new form slams in with a rainbow halo,
// the name cascades letter-by-letter, confetti rains. Dedicated chime
// layer on top of the level-up sting. 4.5s duration — longer than a
// level-up because evolution is rarer (5 across the whole game) and the
// player should savor it.
//
// Sequence:
//   Phase 1 (0-220ms)   Rainbow radial flash in the pet's color
//   Phase 2 (220-900ms) Pet image slams in from below with overshoot
//                       + rotation wobble. Accent-color halo pulses.
//   Phase 3 (700ms+)    Pet name letters cascade (same pattern as
//                       LEVEL UP!). Color-matched to pet accent.
//   Phase 4 (1200ms+)   "UNLOCKED AT LV.N" pill fades in.
//   Phase 5 (1500ms+)   Confetti rain, TAP TO CONTINUE pulse.

import { useEffect, useRef } from "react";
import { playLevelUp, playAchievementChime } from "@/hooks/useAppAudio";
import { useAudioSettings } from "@/hooks/useAudioSettings";

type Pet = { id: string; name: string; src: string; color: string; minLevel: number };

type Props = {
  pet: Pet | null;
  newLevel: number;
  onClose: () => void;
};

export default function PetEvolveToast({ pet, newLevel, onClose }: Props) {
  const playedForPetRef = useRef<string | null>(null);
  const { hapticsOn } = useAudioSettings();

  useEffect(() => {
    if (!pet) { playedForPetRef.current = null; return; }
    if (playedForPetRef.current === pet.id) return;
    playedForPetRef.current = pet.id;

    // Audio stack — 3 stingers spaced for a real "TA-DA!" beat:
    //   t=40ms    level-up arpeggio (flash)
    //   t=600ms   achievement chime (pet lands)
    //   t=1200ms  second chime layer (name cascade finishes)
    const a = setTimeout(() => playLevelUp(), 40);
    const b = setTimeout(() => playAchievementChime(), 600);
    const c = setTimeout(() => playAchievementChime(), 1200);

    // Haptic — pokemon-style longer triple pulse for a bigger moment.
    // Gated on the user's Haptics preference (Settings → Audio).
    if (hapticsOn && typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.([25, 40, 25, 40, 60]); } catch {}
    }

    const dismiss = setTimeout(() => onClose(), 4500);
    return () => {
      clearTimeout(a); clearTimeout(b); clearTimeout(c);
      clearTimeout(dismiss);
    };
  }, [pet, onClose]);

  if (!pet) return null;

  const nameLetters = pet.name.toUpperCase().split("");

  return (
    <div
      role="alert"
      aria-live="assertive"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 2100,
        background: "rgba(2,0,12,0.88)",
        backdropFilter: "blur(12px)",
        overflow: "hidden",
        cursor: "pointer", userSelect: "none",
        animation: "fadeIn 0.25s ease both",
      }}
    >
      {/* Phase 1: pet-color radial flash */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle at 50% 55%, ${pet.color}cc 0%, ${pet.color}55 18%, transparent 55%)`,
        animation: "pet-evolve-flash 0.7s ease-out both",
        pointerEvents: "none",
      }} />

      {/* Pulsing halo behind the pet — stays on for the full duration,
          breathes with the pet */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -55%)",
        width: "min(90vmin, 680px)", height: "min(90vmin, 680px)",
        borderRadius: "50%",
        background: `radial-gradient(circle, ${pet.color}55 0%, ${pet.color}22 32%, transparent 68%)`,
        filter: "blur(22px)",
        animation: "pet-evolve-halo 2.4s ease-in-out infinite 0.6s",
        pointerEvents: "none",
        opacity: 0,
      }} />

      {/* Spinning accent rays — quieter than level-up because the pet
          itself is the visual anchor; rays in the pet's own color */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -55%)",
        width: "min(110vmin, 780px)", height: "min(110vmin, 780px)",
        background: `conic-gradient(
          from 0deg,
          transparent 0deg, ${pet.color}18 6deg, transparent 20deg,
          transparent 60deg, ${pet.color}18 66deg, transparent 80deg,
          transparent 120deg, ${pet.color}18 126deg, transparent 140deg,
          transparent 180deg, ${pet.color}18 186deg, transparent 200deg,
          transparent 240deg, ${pet.color}18 246deg, transparent 260deg,
          transparent 300deg, ${pet.color}18 306deg, transparent 320deg
        )`,
        animation: "lvup-rays 8s linear infinite, lvup-rays-in 0.9s ease-out 0.7s both",
        pointerEvents: "none",
        filter: "blur(2px)",
        opacity: 0,
      }} />

      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "clamp(10px, 3vw, 18px)",
        zIndex: 1,
        width: "100%",
        padding: "0 clamp(16px, 5vw, 32px)",
      }}>
        {/* Eyebrow ribbon */}
        <div style={{
          color: "#fbbf24",
          fontSize: "clamp(11px, 3.2vw, 14px)",
          fontWeight: 900, letterSpacing: "0.42em",
          textShadow: `0 0 16px rgba(251,191,36,0.9), 0 0 32px ${pet.color}66`,
          animation: "fadeIn 0.4s ease 0.1s both",
        }}>
          ✦ EVOLUTION ✦
        </div>

        {/* Pet image — slams in from below with overshoot + wobble */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pet.src}
          alt={pet.name}
          style={{
            width: "clamp(200px, 52vw, 340px)",
            height: "auto",
            filter: `drop-shadow(0 0 30px ${pet.color}) drop-shadow(0 0 70px ${pet.color}99) drop-shadow(0 20px 40px rgba(0,0,0,0.75))`,
            animation: "pet-evolve-slam 0.9s cubic-bezier(0.34, 1.6, 0.64, 1) 0.22s both, pet-breathe 2.8s ease-in-out infinite 1.2s",
          }}
        />

        {/* Pet name — letter cascade */}
        <div style={{
          display: "flex", justifyContent: "center",
          gap: "clamp(1px, 0.5vw, 4px)",
          flexWrap: "wrap",
        }}>
          {nameLetters.map((ch, i) => (
            <span key={i} style={{
              color: ch === " " ? "transparent" : "white",
              fontSize: "clamp(20px, 6.5vw, 34px)",
              fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1,
              textShadow: `0 0 14px ${pet.color}, 0 0 28px ${pet.color}aa, 0 4px 8px rgba(0,0,0,0.8)`,
              WebkitTextStroke: ch === " " ? "0" : `1.5px ${pet.color}`,
              transform: "translateY(-30px) scale(0.4)",
              opacity: 0,
              animation: ch === " " ? "none" : `lvup-letter-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${700 + i * 55}ms both`,
              minWidth: ch === " " ? "clamp(4px, 1.5vw, 10px)" : "auto",
              display: "inline-block",
            }}>{ch}</span>
          ))}
        </div>

        {/* Level pill — fades in after the name finishes */}
        <div style={{
          padding: "clamp(7px, 2vw, 10px) clamp(16px, 4.5vw, 26px)",
          borderRadius: "999px",
          background: `linear-gradient(180deg, ${pet.color}66 0%, ${pet.color}22 100%)`,
          border: `1.5px solid ${pet.color}`,
          color: "white",
          fontSize: "clamp(10px, 2.8vw, 12px)",
          fontWeight: 900, letterSpacing: "0.24em",
          textShadow: `0 0 10px ${pet.color}`,
          boxShadow: `0 0 20px ${pet.color}55, inset 0 1px 0 rgba(255,255,255,0.2)`,
          animation: `fadeIn 0.4s ease ${700 + nameLetters.length * 55 + 200}ms both`,
        }}>
          UNLOCKED AT LV.{pet.minLevel}
        </div>
      </div>

      {/* Confetti rain — mixed pet-color + gold specks, heavier shower
          than level-up because evolution is the bigger moment */}
      {Array.from({ length: 26 }).map((_, i) => {
        const color = i % 3 === 0 ? pet.color : i % 3 === 1 ? "#fbbf24" : "#f9a8d4";
        const left = `${(i * 41) % 100}%`;
        const delay = 0.9 + (i % 8) * 0.14;
        const dur = 2.4 + ((i * 11) % 12) * 0.1;
        const size = 7 + (i % 5) * 3;
        return (
          <div key={i} style={{
            position: "absolute",
            top: "-20px", left,
            width: size, height: size * 2,
            background: color,
            borderRadius: "2px",
            boxShadow: `0 0 ${size}px ${color}`,
            animation: `lvup-confetti ${dur}s linear ${delay}s both`,
            pointerEvents: "none",
            opacity: 0,
          }} />
        );
      })}

      {/* Bottom CTA + level context */}
      <div style={{
        position: "absolute",
        bottom: "clamp(20px, 9vh, 72px)", left: 0, right: 0,
        textAlign: "center",
        animation: "fadeIn 0.4s ease 2.1s both",
        pointerEvents: "none",
      }}>
        <div style={{
          color: "rgba(254,215,170,0.85)",
          fontSize: "clamp(12px, 3.4vw, 15px)",
          fontWeight: 800, letterSpacing: "0.08em",
          textShadow: "0 2px 6px rgba(0,0,0,0.7)",
        }}>
          Your pet evolved at level {newLevel}
        </div>
        <div style={{
          marginTop: "8px",
          color: "rgba(200,180,255,0.55)",
          fontSize: "clamp(9px, 2.6vw, 11px)",
          fontWeight: 700, letterSpacing: "0.18em",
          animation: "lvup-cta-pulse 1.4s ease-in-out infinite 2.6s",
        }}>
          TAP ANYWHERE TO CONTINUE
        </div>
      </div>
    </div>
  );
}
