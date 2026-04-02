// ─── Daily Challenge Seed ──────────────────────────────────────────
// Same seed for everyone on the same day → same sequence
export function getDailySeed() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Seeded random number generator (deterministic)
export function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// Generate daily rhythm sequence (which buttons appear in what order)
export function getDailyRhythmSequence(length = 40) {
  const rng = seededRandom(getDailySeed());
  return Array.from({ length }, () => Math.floor(rng() * 4) + 1);
}

// Generate daily simon sequence
export function getDailySimonSequence(colors, length = 20) {
  const rng = seededRandom(getDailySeed() + 1); // offset so it's different from rhythm
  return Array.from({ length }, () => colors[Math.floor(rng() * colors.length)].id);
}

// ─── Play Streak Tracking (from Supabase via backend) ─────────────
const BACKEND = import.meta.env.VITE_GAMES_BACKEND_URL || 'http://localhost:3005';

export async function getPlayStreak(address) {
  if (!address) return { streak: 0, playedToday: false };
  try {
    const res = await fetch(`${BACKEND}/api/streak/${address}`);
    return await res.json();
  } catch (_) {
    return { streak: 0, playedToday: false };
  }
}

// recordPlay is now handled server-side via registerUser on score submit
export function recordPlay() {
  // no-op — streak updates happen in backend on score submission
  return null;
}

// ─── Live Score Notifications ─────────────────────────────────────
let lastActivityCheck = 0;
const POLL_INTERVAL = 15000; // 15 seconds

export async function checkNewHighScores(backendUrl, onNewScore) {
  const now = Date.now();
  if (now - lastActivityCheck < POLL_INTERVAL) return;
  lastActivityCheck = now;

  try {
    const res = await fetch(`${backendUrl}/api/activity`);
    const { activity } = await res.json();
    if (!activity || activity.length === 0) return;

    const latest = activity[0];
    const lastSeen = parseInt(localStorage.getItem('last_seen_activity') || '0');

    if (latest.timestamp > lastSeen) {
      localStorage.setItem('last_seen_activity', String(latest.timestamp));
      if (lastSeen > 0) { // Don't fire on first load
        const name = latest.username || `${latest.player.slice(0, 6)}...${latest.player.slice(-4)}`;
        const gameLabel = latest.game === 'rhythm' ? 'Rhythm Rush' : 'Simon Memory';
        onNewScore(`${name} scored ${latest.score} on ${gameLabel}!`);
      }
    }
  } catch (_) {}
}
