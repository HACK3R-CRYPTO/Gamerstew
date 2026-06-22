// ─── Achievement catalog (client mirror) ─────────────────────────────────────
// Mirrors games-backend/server.js's ACHIEVEMENT_CATALOG so the finished
// screen can always display names + icons even if the live backend is
// stale (e.g. before a Railway redeploy) or returns the legacy
// string-only shape (just `['first_win', 'rhythm_hero']`).
//
// Keep this in sync when new achievements are added server-side. The
// server remains the source of truth for WHEN things unlock; this file
// is purely for presentation.

export type AchievementMeta = {
  id: string;
  icon: string;
  name: string;
  desc: string;
};

export const ACHIEVEMENT_META: Record<string, AchievementMeta> = {
  first_win:   { id: "first_win",   icon: "🥇", name: "First Win",         desc: "Win your first game" },
  streak_3:    { id: "streak_3",    icon: "🔥", name: "3-Day Streak",      desc: "Play 3 days in a row" },
  streak_7:    { id: "streak_7",    icon: "🔥", name: "Week Warrior",      desc: "Play 7 days in a row" },
  streak_30:   { id: "streak_30",   icon: "🔥", name: "Month Master",      desc: "Play 30 days in a row" },
  games_5:     { id: "games_5",     icon: "🎮", name: "Getting Started",   desc: "Play 5 games total" },
  games_25:    { id: "games_25",    icon: "🎮", name: "Regular Player",    desc: "Play 25 games total" },
  games_100:   { id: "games_100",   icon: "💎", name: "Veteran",           desc: "Play 100 games total" },
  // Calibrated to top-tier Rhythm Rush scoring (peak runs hit 400k+).
  // Geometric 2× progression: Apprentice 60k → Master 200k → Legend
  // 400k. IDs unchanged so server-issued unlocks still map to the
  // same row. Keep in sync with games-backend/server.js
  // ACHIEVEMENT_CATALOG.
  rhythm_300:  { id: "rhythm_300",  icon: "🥁", name: "Drum Apprentice",   desc: "Score 60,000+ in Rhythm Rush" },
  rhythm_500:  { id: "rhythm_500",  icon: "🥁", name: "Rhythm Master",     desc: "Score 200,000+ in Rhythm Rush" },
  rhythm_700:  { id: "rhythm_700",  icon: "👑", name: "Rhythm Legend",     desc: "Score 400,000+ in Rhythm Rush" },
  rhythm_fc:   { id: "rhythm_fc",   icon: "✨", name: "Full Combo",        desc: "Clear the rhythm chart without missing a note" },
  rhythm_ap:   { id: "rhythm_ap",   icon: "🌟", name: "All Perfect",       desc: "Every hit PERFECT — no goods, no misses" },
  simon_5:     { id: "simon_5",     icon: "🧠", name: "Memory Apprentice", desc: "Reach round 5 in Simon Memory" },
  simon_10:    { id: "simon_10",    icon: "🧠", name: "Memory Master",     desc: "Reach round 10 in Simon Memory" },
  simon_15:    { id: "simon_15",    icon: "👑", name: "Memory Legend",     desc: "Reach round 15 in Simon Memory" },
};

// Accepts whatever shape the backend returns (string id OR the hydrated
// object) and produces a normalized { id, icon, name, desc }. Falls back
// gracefully if an id we haven't seen before lands — the user at least
// sees a human-readable token instead of an orphan trophy.
export function hydrateAchievement(
  raw: string | { id?: string; name?: string; icon?: string; desc?: string },
): AchievementMeta {
  if (typeof raw === "string") {
    return ACHIEVEMENT_META[raw] ?? {
      id: raw,
      icon: "🏆",
      name: raw.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      desc: "",
    };
  }
  const meta = raw.id ? ACHIEVEMENT_META[raw.id] : undefined;
  return {
    id: raw.id ?? meta?.id ?? "unknown",
    icon: raw.icon || meta?.icon || "🏆",
    name: raw.name || meta?.name || (raw.id ? raw.id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Achievement"),
    desc: raw.desc || meta?.desc || "",
  };
}
