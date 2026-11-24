"use client";

// ─── The opening screen ──────────────────────────────────────────────────────
// What a visitor sees for about a second before the games. It is the app's
// first impression, so it wears the app's own look: the light lilac page, the
// logo, and one plain progress bar. (It used to be a dark neon scene with a
// make-believe terminal line typing "INITIALIZING_GAME_ARENA".)

import { useEffect } from "react";
import { preload } from "react-dom";
import { useRouter } from "next/navigation";
import { captureReferralFromUrl } from "@/lib/referral";

const SHOW_MS = 1200; // long enough not to flash by, short enough not to be a wait
const BITS: { src: string; x: string; y: string; size: number; turn: number; delay: number }[] = [
  { src: "/splash_screen_icons/gamepad.png", x: "8%", y: "14%", size: 64, turn: -14, delay: 0 },
  { src: "/splash_screen_icons/golden_music.png", x: "82%", y: "18%", size: 56, turn: 12, delay: 0.5 },
  { src: "/splash_screen_icons/dice.png", x: "12%", y: "74%", size: 60, turn: 10, delay: 0.9 },
  { src: "/splash_screen_icons/joystick.png", x: "80%", y: "70%", size: 58, turn: -8, delay: 0.3 },
];

export default function SplashScreen() {
  preload("/logo-full.png", { as: "image", fetchPriority: "high" }); // the logo is the first thing painted
  const router = useRouter();

  // A share link's ?ref has to be read before the move to the dashboard, which
  // drops the query string. Safe to call when there is none.
  useEffect(() => { captureReferralFromUrl(); }, []);

  // Everyone lands on the dashboard: the games, straight away. Signing in is one
  // tap from there, for the moment a player wants to keep a score.
  useEffect(() => {
    const dest = "/dashboard";
    router.prefetch(dest);
    let cancelled = false;
    const t = setTimeout(() => { if (!cancelled) router.push(dest); }, SHOW_MS);
    return () => { cancelled = true; clearTimeout(t); };
  }, [router]);

  return (
    <main className="sp" role="status" aria-live="polite" aria-label="Loading GameArena">
      {BITS.map((b) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={b.src} className="sp-bit" src={b.src} alt="" width={b.size} height={b.size} loading="lazy" decoding="async"
          style={{ left: b.x, top: b.y, ["--turn" as string]: `${b.turn}deg`, animationDelay: `${b.delay}s` }} />
      ))}
      <div className="sp-mid">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sp-logo" src="/logo-full.png" alt="Game Arena" fetchPriority="high" decoding="async" />
        <div className="sp-bar" aria-hidden><i /></div>
        <p>Loading your games</p>
      </div>
      <style>{`
        .sp { position: fixed; inset: 0; overflow: hidden; display: grid; place-items: center; background: radial-gradient(120% 60% at 50% 0%, #fbf8ff 0%, #f0e8ff 45%, #e2d6ff 100%); color: #22104f; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
        .sp-mid { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 0 24px; }
        .sp-logo { width: clamp(220px, 56vw, 460px); height: auto; filter: drop-shadow(0 18px 22px rgba(76,29,149,0.28)); animation: spPop .5s cubic-bezier(.2,.9,.3,1.25) both; }
        @keyframes spPop { from { opacity: 0; transform: scale(.86) translateY(8px); } }
        .sp-bar { width: min(260px, 62vw); height: 10px; border-radius: 999px; background: rgba(76,29,149,0.14); overflow: hidden; }
        .sp-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #a78bfa, #6d28d9); transform-origin: left; animation: spFill ${SHOW_MS}ms cubic-bezier(.3,.6,.3,1) both; }
        @keyframes spFill { from { transform: scaleX(0.04); } to { transform: scaleX(1); } }
        .sp p { margin: 0; font-size: 14px; font-weight: 700; color: rgba(34,16,79,0.66); }
        .sp-bit { position: absolute; opacity: 0.5; transform: rotate(var(--turn)); animation: spFloat 4.2s ease-in-out infinite; pointer-events: none; }
        @keyframes spFloat { 50% { transform: rotate(var(--turn)) translateY(-10px); } }
        @media (max-width: 520px) { .sp-bit { opacity: 0.32; transform: rotate(var(--turn)) scale(0.8); } }
        @media (prefers-reduced-motion: reduce) { .sp-logo, .sp-bit { animation: none; } .sp-bar i { animation: none; } }
      `}</style>
    </main>
  );
}
