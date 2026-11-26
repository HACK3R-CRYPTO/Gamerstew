"use client";

// What every game's start screen tells a guest, in the same words: that they are
// a guest, how many free plays are left, and a link to sign in. Renders nothing
// for a signed-in player (`left` is null then; see hooks/useGuestGate).

import Link from "next/link";

export default function GuestLine({ left, dark = false }: { left: number | null; dark?: boolean }) {
  if (left === null) return null;
  const ink = dark ? "rgba(255,255,255,0.86)" : "rgba(34,16,79,0.72)";
  return (
    <div style={{ textAlign: "center", font: '600 13px "Fredoka", system-ui, sans-serif', lineHeight: 1.4, color: ink }}>
      {left > 0 ? <>Playing as a guest. <b style={{ color: dark ? "#fff" : "#22104f" }}>{left} free {left === 1 ? "play" : "plays"} left.</b> </> : <>Your free plays are used. </>}
      <Link href="/home?signin=1" style={{ color: dark ? "#fde68a" : "#6d28d9", fontWeight: 700, textDecoration: "underline" }}>Sign in</Link> to {left > 0 ? "rank your scores" : "keep playing and rank your scores"}.
    </div>
  );
}
