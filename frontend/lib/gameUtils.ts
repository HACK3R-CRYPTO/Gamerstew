// ─── Daily Challenge Seed ──────────────────────────────────────────
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

export function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function getDailyRhythmSequence(length = 40) {
  const rng = seededRandom(getDailySeed());
  return Array.from({ length }, () => Math.floor(rng() * 4) + 1);
}

export function getDailySimonSequence(colors: { id: string }[], length = 20) {
  const rng = seededRandom(getDailySeed() + 1);
  return Array.from({ length }, () => colors[Math.floor(rng() * colors.length)].id);
}

// ─── Play Streak ────────────────────────────────────────────────────
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3005';

export async function getPlayStreak(address: string) {
  if (!address) return { streak: 0, playedToday: false };
  try {
    const res = await fetch(`${BACKEND}/api/streak/${address}`);
    return await res.json();
  } catch (_) {
    return { streak: 0, playedToday: false };
  }
}

export function recordPlay() {
  return null;
}

// ─── Live Score Notifications ─────────────────────────────────────
let lastActivityCheck = 0;
const POLL_INTERVAL = 15000;

export async function checkNewHighScores(backendUrl: string, onNewScore: (msg: string) => void) {
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
      if (lastSeen > 0) {
        const name = latest.username || `${latest.player.slice(0, 6)}...${latest.player.slice(-4)}`;
        const gameLabel = latest.game === 'rhythm' ? 'Rhythm Rush' : 'Simon Memory';
        onNewScore(`${name} scored ${latest.score} on ${gameLabel}!`);
      }
    }
  } catch (_) {}
}
