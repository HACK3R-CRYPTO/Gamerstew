"use client";

import { useAppAudio } from "@/hooks/useAppAudio";

// Thin client wrapper so the root layout (a server component by default)
// can mount the useAppAudio hook. Renders nothing — it just installs the
// ambient-pad loop and the global UI click listener.
export default function AppAudio() {
  useAppAudio();
  return null;
}
