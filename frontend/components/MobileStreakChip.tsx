"use client";

// Floating streak indicator for mobile. On desktop the streak lives in the
// left sidebar (games/leaderboard/profile). The sidebar is hidden below
// 768px to free real estate for the bottom tab bar, so without this chip
// the streak would be invisible on mobile — and the whole "play daily or
// your streak freezes" loop is the core retention mechanic.
//
// Visual rules mirror the sidebar chip so it feels like the same object
// just repositioned:
//   • Played today → warm orange flame, alive
//   • Not played today → FROZEN (blue via hue-rotate), readable as "on ice,
//     play to thaw". Same signal we rely on in the sidebar.

type Props = { streak: number; playedToday: boolean };

export default function MobileStreakChip({ streak, playedToday }: Props) {
  if (streak <= 0) return null;

  return (
    <div
      aria-label={`${streak} day streak${playedToday ? "" : " — play today to keep it"}`}
      style={{
        position: "fixed",
        // Float bottom-right above the 64px BottomNav. Top-right collides
        // with page-level content (tabs on leaderboard, profile card
        // header), and on games we moved streak inline into the stats
        // pill row instead. Bottom-right stays clear on every mobile page.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
        right: "12px",
        zIndex: 40,
        display: "flex", alignItems: "center", gap: "5px",
        padding: "6px 12px",
        borderRadius: "999px",
        background: playedToday
          ? "linear-gradient(180deg, #7c2d00 0%, #3f1300 100%)"
          : "linear-gradient(180deg, #0c2742 0%, #041022 100%)",
        border: `1.5px solid ${playedToday ? "#f97316" : "#38bdf8"}`,
        boxShadow: playedToday
          ? "0 0 12px rgba(249,115,22,0.6), 0 4px 10px rgba(0,0,0,0.5)"
          : "0 0 10px rgba(56,189,248,0.45), 0 4px 10px rgba(0,0,0,0.5)",
        userSelect: "none",
        pointerEvents: "none", // purely informational, no tap handler
      }}
    >
      <span style={{
        fontSize: "14px", lineHeight: 1,
        filter: playedToday
          ? "drop-shadow(0 0 5px rgba(249,115,22,0.9))"
          : "hue-rotate(190deg) saturate(1.3) brightness(0.95) drop-shadow(0 0 4px rgba(56,189,248,0.7))",
      }}>🔥</span>
      <span style={{
        color: playedToday ? "#fbbf24" : "#bae6fd",
        fontSize: "12px", fontWeight: 900, lineHeight: 1,
        textShadow: playedToday
          ? "0 0 6px rgba(251,191,36,0.7)"
          : "0 0 5px rgba(56,189,248,0.6)",
      }}>{streak}</span>
    </div>
  );
}
