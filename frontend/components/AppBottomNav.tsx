"use client";

import { usePathname, useRouter } from "next/navigation";
import { playClick } from "@/hooks/useAppAudio";

const T = {
  accent: "#a78bfa",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  hairlineHi: "rgba(255,255,255,0.16)",
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

// 5-tab nav: Home / Play / Shop / Events / Pet. Shop sits in the center
// (Brawl Stars + Clash Royale pattern) so it gets eye-tracking priority
// and is always one tap from anywhere in the app — no buried-in-profile
// monetization surface. The shop icon also carries a subtle gold tint
// so the commerce affordance reads even when the tab isn't active.
const ITEMS = [
  { id: "home",   label: "Home",   href: "/dashboard",   icon: "M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z", accent: undefined as string | undefined },
  { id: "play",   label: "Play",   href: "/games",       icon: "M8 5v14l11-7z", accent: undefined },
  { id: "shop",   label: "Shop",   href: "/shop",        icon: "M5 4h14l1 4H4zm0 5h14v11H5zm4 2v3a3 3 0 0 0 6 0v-3h-2v3a1 1 0 0 1-2 0v-3z", accent: "#fbbf24" },
  { id: "events", label: "Events", href: "/leaderboard", icon: "M7 4h10v2h3v3a4 4 0 0 1-4 4 5 5 0 0 1-4 3v2h3v2H9v-2h3v-2a5 5 0 0 1-4-3 4 4 0 0 1-4-4V6h3zm0 4H5v1a2 2 0 0 0 2 2zm10 0v3a2 2 0 0 0 2-2V8z", accent: undefined },
  { id: "pet",    label: "Pet",    href: "/profile",     icon: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10m0 2c-4 0-9 2-9 6v2h18v-2c0-4-5-6-9-6", accent: undefined },
];

function activeId(pathname: string): string {
  if (pathname.startsWith("/dashboard")) return "home";
  if (pathname.startsWith("/games")) return "play";
  if (pathname.startsWith("/shop")) return "shop";
  if (pathname.startsWith("/leaderboard") || pathname.startsWith("/events")) return "events";
  if (pathname.startsWith("/profile")) return "pet";
  return "";
}

export default function AppBottomNav({ wide = false }: { wide?: boolean }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const active = activeId(pathname);

  const wideStyle: React.CSSProperties = {
    position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)", zIndex: 60,
    display: "grid", gridTemplateColumns: "repeat(5, 72px)", gap: 4, padding: 6,
    background: "rgba(8,2,32,0.92)", backdropFilter: "blur(16px)",
    border: `1px solid ${T.hairlineHi}`, borderRadius: 999,
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  };
  const mobileStyle: React.CSSProperties = {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
    padding: "8px 8px calc(env(safe-area-inset-bottom, 0px) + 8px)",
    background: "rgba(8,2,32,0.88)", backdropFilter: "blur(12px)",
    borderTop: `1px solid ${T.hairline}`,
    display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2,
  };

  return (
    <nav style={wide ? wideStyle : mobileStyle}>
      {ITEMS.map(it => {
        const isActive = active === it.id;
        // Shop tab uses a gold accent (the commerce signal) instead of
        // the default violet, so the monetization surface reads as
        // distinct even when it isn't the active tab.
        const idleColor = it.accent ? it.accent + "cc" : T.inkSoft;
        const activeColor = it.accent ?? T.accent;
        return (
          <button key={it.id} onClick={() => { playClick(); router.push(it.href); }} aria-current={isActive ? "page" : undefined} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            padding: "8px 2px", borderRadius: wide ? 999 : 12, cursor: "pointer",
            background: isActive ? `${activeColor}1a` : "transparent", border: "none",
            color: isActive ? activeColor : idleColor,
            transition: "all 0.15s",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d={it.icon} /></svg>
            <span style={{ fontFamily: T.body, fontSize: 9, fontWeight: 800, letterSpacing: "0.08em" }}>{it.label.toUpperCase()}</span>
          </button>
        );
      })}
    </nav>
  );
}
