"use client";

// ─── The guest limit, in one place ───────────────────────────────────────────
// A visitor who has not signed in gets GUEST_PLAY_LIMIT free runs of a game.
// After that, starting another run opens the sign-in prompt instead. Rounds in
// a friend room never count and are never blocked: a friend's invite should
// always work. Counting lives in lib/guestLimit (this browser only): it is a
// nudge to sign in, not a security control.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import GuestLimitPrompt from "@/components/GuestLimitPrompt";
import { useAuthStatus } from "@/hooks/useRequireAuth";
import { bumpGuestPlayed, guestPlaysLeft, GUEST_PLAY_LIMIT } from "@/lib/guestLimit";
import { track } from "@/lib/track";

export function useGuestGate(key: string, label: string): { /** call when a solo run is about to start; false means it was stopped and the prompt is showing */ allow: () => boolean; /** free runs left, or null for a signed-in player */ left: number | null; prompt: ReactNode } {
  const { authed, pending } = useAuthStatus();
  const guest = !authed && !pending;
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(GUEST_PLAY_LIMIT);
  useEffect(() => { setLeft(guestPlaysLeft(key)); }, [key]);
  const allow = useCallback(() => {
    if (!guest) return true;
    if (guestPlaysLeft(key) <= 0) { setOpen(true); track("guest_limit_hit", { game: label }); return false; }
    bumpGuestPlayed(key); setLeft(guestPlaysLeft(key));
    return true;
  }, [guest, key, label]);
  return { allow, left: guest ? left : null, prompt: <GuestLimitPrompt open={open} onClose={() => setOpen(false)} game={label} /> };
}
