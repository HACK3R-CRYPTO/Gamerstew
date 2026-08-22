"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAudioSettings } from "@/hooks/useAudioSettings";

// ─── MARKOV's voice ─────────────────────────────────────────────────────────
// MARKOV already generates taunt TEXT (markovLine / matchLine / mindGame). This
// speaks it via the Web Speech API — zero deps, zero cost, offline, no API key.
// A low pitch + slightly slow rate reads as a cold machine, which is exactly
// MARKOV's character, so the synthetic timbre is on-brand, not a limitation.
//
// Honors the app's SFX toggle + volume (settings.sfxOn / sfxVol). Every new line
// cancels the previous one so taunts never stack or talk over each other.
//
// Upgrade path: swap the body of speak() for pre-rendered clips (ElevenLabs /
// stablevoice) keyed by line — the call sites never change.

export type RankTier = "champion" | "contender" | "rookie";

// Where the player stands shapes how MARKOV addresses them: cold respect at the
// top, mockery at the bottom. Rank (ladder) wins; level is the fallback for a
// player who hasn't ranked yet.
export function rankTier(rank: number | null | undefined, level: number): RankTier {
  if (rank != null && rank > 0 && rank <= 10) return "champion";
  if ((rank != null && rank > 0) || level >= 8) return "contender";
  return "rookie";
}

// Rank-aware opening taunts. "{r}" is filled with the player's rank when known.
const INTRO: Record<RankTier, string[]> = {
  champion: [
    "Rank {r}. Finally, someone worth reading.",
    "Top ten. I have already beaten everyone above you.",
    "The leaderboard flatters you. I do not.",
  ],
  contender: [
    "Rank {r}. I mapped your patterns three matches ago.",
    "Climbing the ladder? I am the ladder.",
    "You think you are close. You are not.",
  ],
  rookie: [
    "A new challenger. This will be quick.",
    "No rank, no chance.",
    "I remember every throw you will ever make.",
  ],
};

// Deterministic-ish pick so a match's intro doesn't reroll every render but
// still varies match to match. Callers pass a seed (round count, match id, etc).
function pick(lines: string[], seed: number): string {
  return lines[Math.abs(seed) % lines.length];
}

export function intro(tier: RankTier, rank: number | null | undefined, seed: number): string {
  return pick(INTRO[tier], seed).replace("{r}", rank && rank > 0 ? `#${rank}` : "unranked");
}

export function useMarkovVoice() {
  const { sfxOn, sfxVol } = useAudioSettings();
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const supported = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    supported.current = true;
    const choose = () => {
      const vs = window.speechSynthesis.getVoices();
      // Prefer a deep English male voice for the villain read; fall back to any
      // English voice, then whatever exists.
      voiceRef.current =
        vs.find((v) => /^en(-|_)?(us|gb)/i.test(v.lang) && /(daniel|alex|fred|arthur|male|uk english male)/i.test(v.name)) ||
        vs.find((v) => /^en/i.test(v.lang)) ||
        vs[0] ||
        null;
    };
    choose();
    window.speechSynthesis.onvoiceschanged = choose;
    return () => {
      try { window.speechSynthesis.onvoiceschanged = null; window.speechSynthesis.cancel(); } catch { /* noop */ }
    };
  }, []);

  // pitch/rate default to MARKOV's cold-machine delivery; callers can nudge them
  // (e.g. a touch higher/faster when mocking a rookie).
  const speak = useCallback((line: string, opts?: { pitch?: number; rate?: number }) => {
    if (!sfxOn || !supported.current || !line) return;
    try {
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(line);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.lang = voiceRef.current?.lang || "en-US";
      u.pitch = opts?.pitch ?? 0.5;
      u.rate = opts?.rate ?? 0.95;
      u.volume = Math.max(0, Math.min(1, sfxVol / 100));
      synth.cancel(); // never let two lines overlap
      // Chrome drops speak() called synchronously right after cancel() — the
      // cancel is async, so we defer a tick to let the queue clear, otherwise
      // the new line is silently eaten (this is why lines went missing).
      setTimeout(() => { try { synth.speak(u); } catch { /* noop */ } }, 60);
    } catch { /* speech unsupported on this device · stay silent */ }
  }, [sfxOn, sfxVol]);

  const stop = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }, []);

  return { speak, stop, supported: supported.current };
}
