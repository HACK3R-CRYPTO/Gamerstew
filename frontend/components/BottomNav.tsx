"use client";

import { usePathname, useRouter } from "next/navigation";

// ─── BottomNav ──────────────────────────────────────────────────────────────
// Mobile-only fixed-bottom tab bar. Replaces the 68px vertical sidebar used on
// desktop for profile / games / leaderboard. Renders 4 icons + labels across
// a dark translucent bar, with the active tab highlighted. Safe-area padding
// accounts for the iPhone home indicator / Android gesture bar.
//
// Why bottom tabs over a shrunken sidebar on mobile:
//   • Thumb-reach: tabs sit in the natural one-handed zone
//   • Familiarity: same pattern as Instagram / Twitter / Spotify / Duolingo
//   • Screen real estate: a horizontal 64px bar costs less % of a 390px
//     portrait screen than a vertical 68px sidebar costs (~18% of width)
//   • The app is mobile-first (Celo MiniPay), so this is the primary shape
//
// Usage: render at the end of the page when `useIsMobile()` is true, and add
// ~72px of bottom padding to the main scroll area so content doesn't hide
// under the bar.

type NavItem = { label: string; path: string; icon: React.ReactNode };

const NAV_ITEMS: NavItem[] = [
  { label: "Home",        path: "/home",        icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg> },
  { label: "Games",       path: "/games",       icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3a1 1 0 00-1 1v10a1 1 0 001 1h18a1 1 0 001-1V7a1 1 0 00-1-1zm-10 7H9v2H7v-2H5v-2h2V9h2v2h2v2zm4.5 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-3a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg> },
  { label: "Leaderboard", path: "/leaderboard", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h6v11zm2 0V6a2 2 0 012-2h4a2 2 0 012 2v13h-8z" /></svg> },
  { label: "Profile",     path: "/profile",     icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" /></svg> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        position: "fixed",
        left: 0, right: 0, bottom: 0,
        zIndex: 50,
        // Solid-dark translucent bar, matches the 0.95 alpha of the desktop
        // sidebar so it reads like the same chrome, just reoriented.
        background: "rgba(4,1,18,0.96)",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 -8px 24px rgba(0,0,0,0.5)",
        // Safe-area padding — iPhone home indicator lives in the bottom 34px.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        // Hardware-accelerate to keep scroll buttery smooth on iOS
        transform: "translateZ(0)",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-around",
        padding: "8px 6px 6px",
        gap: "4px",
      }}>
        {NAV_ITEMS.map(item => {
          const active = pathname?.startsWith(item.path);
          return (
            <button
              key={item.path}
              onClick={() => router.push(item.path)}
              // Opt out of the global UI click blip — the nav tap already
              // gets the tab-switch tick if we want it, and doubling up feels
              // noisy. (The global listener handles other buttons in the app.)
              data-no-click-sound="true"
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              style={{
                flex: "1 1 0",
                borderRadius: "12px",
                padding: "6px 4px",
                background: active ? "rgba(255,255,255,0.14)" : "transparent",
                border: "none",
                color: active ? "white" : "rgba(255,255,255,0.55)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "2px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
                boxShadow: active
                  ? "0 0 0 1px rgba(255,255,255,0.12), 0 4px 10px rgba(0,0,0,0.4)"
                  : "none",
                // Keep each item a comfortable touch target (Apple HIG: 44pt)
                minHeight: "52px",
              }}
            >
              {item.icon}
              <span style={{
                fontSize: "9px",
                fontWeight: 800,
                letterSpacing: "0.06em",
              }}>{item.label.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
