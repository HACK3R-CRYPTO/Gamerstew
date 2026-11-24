"use client";

import { usePathname, useRouter } from "next/navigation";
import { playClick } from "@/hooks/useAppAudio";

// Four places, not five. "Play" is gone: the home screen is the games now, so
// a second page listing the same games was one more place to get lost. "Pet"
// is "Me" because that page is the player's profile.
//
// One component, two shapes:
//   phone / tablet  a floating dock at the bottom, the active item in a pill
//                   that slides between places
//   desktop (wide)  the same four places as a pill in the top bar, where a
//                   mouse expects navigation, with labels always showing
//
// `tone` picks the colours: "light" for the lilac screens, "dark" for the
// screens that are still deep purple.
const ITEMS = [
  { id: "home", label: "Home", href: "/dashboard", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { id: "ranks", label: "Ranks", href: "/leaderboard", icon: "M7 4h10v3a5 5 0 0 1-10 0zM5 5H3v2a3 3 0 0 0 3 3M19 5h2v2a3 3 0 0 1-3 3M10 14h4v3h3v3H7v-3h3z" },
  { id: "shop", label: "Shop", href: "/shop", icon: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" },
  { id: "me", label: "Me", href: "/profile", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0z" },
] as const;

function activeIndex(pathname: string): number {
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/games")) return 0;
  if (pathname.startsWith("/leaderboard") || pathname.startsWith("/events") || pathname.startsWith("/duel")) return 1;
  if (pathname.startsWith("/shop")) return 2;
  if (pathname.startsWith("/profile") || pathname.startsWith("/settings")) return 3;
  return -1;
}

const TONES = {
  light: { bg: "rgba(255,255,255,0.92)", line: "rgba(76,29,149,0.14)", idle: "rgba(34,16,79,0.55)", pill: "#6d28d9", on: "#ffffff", shadow: "0 16px 36px -14px rgba(76,29,149,0.55)" },
  dark: { bg: "rgba(31,15,71,0.9)", line: "rgba(196,181,253,0.2)", idle: "rgba(233,224,255,0.6)", pill: "#c4b5fd", on: "#1c0b45", shadow: "0 16px 36px -14px rgba(0,0,0,0.85)" },
};

export default function AppBottomNav({ wide = false, tone = "light" }: { wide?: boolean; tone?: "light" | "dark" }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const ix = activeIndex(pathname);
  const c = TONES[tone];
  return (
    <nav className={`ga-nav ${wide ? "wide" : "dock"}`} aria-label="Main" style={{ ["--ix" as string]: Math.max(ix, 0), ["--n" as string]: ITEMS.length, background: c.bg, borderColor: c.line, boxShadow: c.shadow }}>
      {ix >= 0 && <span className="ga-nav-pill" style={{ background: c.pill }} aria-hidden />}
      {ITEMS.map((it, i) => (
        <button key={it.id} className={i === ix ? "on" : ""} aria-current={i === ix ? "page" : undefined} aria-label={it.label}
          onClick={() => { playClick(); router.push(it.href); }} onMouseEnter={() => router.prefetch(it.href)}
          style={{ color: i === ix ? c.on : c.idle }}>
          <svg viewBox="0 0 24 24" width="21" height="21"><path d={it.icon} fill={i === ix ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
          <span>{it.label}</span>
        </button>
      ))}
      <style>{`
        .ga-nav { position: fixed; z-index: 60; display: grid; grid-template-columns: repeat(var(--n), 1fr); align-items: center; padding: 6px; border: 1px solid; backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
        .ga-nav button { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 7px; height: 46px; background: none; border: none; cursor: pointer; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 12.5px; font-weight: 800; -webkit-tap-highlight-color: transparent; transition: color .2s ease, transform .2s cubic-bezier(.2,.9,.3,1.4); }
        .ga-nav button:active { transform: scale(0.9); }
        .ga-nav-pill { position: absolute; z-index: 0; top: 6px; bottom: 6px; left: 6px; width: calc((100% - 12px) / var(--n)); border-radius: 999px; transform: translateX(calc(var(--ix) * 100%)); transition: transform .38s cubic-bezier(.3,1.3,.4,1); }
        .ga-nav.dock { left: 14px; right: 14px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); max-width: 460px; margin: 0 auto; border-radius: 999px; }
        .ga-nav.dock button span { display: none; }
        .ga-nav.dock button.on span { display: inline; }
        .ga-nav.wide { top: 11px; left: 50%; transform: translateX(-50%); width: 440px; border-radius: 999px; box-shadow: none !important; }
        .ga-nav.wide button { height: 34px; }
        .ga-nav.wide button svg { width: 17px; height: 17px; }
        @media (prefers-reduced-motion: reduce) { .ga-nav-pill, .ga-nav button { transition: none; } }
      `}</style>
    </nav>
  );
}
