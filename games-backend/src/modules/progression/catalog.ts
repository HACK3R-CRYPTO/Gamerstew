// ─── The game's fixed tables: games, levels, missions, achievements ──────────
// Pure data and pure functions. Nothing here touches a database. These numbers
// are the game's economy, so they live in one file and are covered by tests.

// ADDING A GAME: the database must be told too. game_sessions has a check that
// lists every allowed game name; a name missing from it makes /api/start-game
// answer 500 and the game silently plays unranked (this happened to ladder,
// strike and nepa3d). Add the name in a migration under supabase-migrations/.
export const GAME_TYPE: Record<string, number> = { rhythm: 0, simon: 1, stack: 2, nepa: 4, ladder: 5, strike: 6, nepa3d: 7 };
export const VALID_GAMES = Object.keys(GAME_TYPE);
/** MARKOV matches are recorded on GamePass under this type (not a skill game) */
export const CHALLENGE_AI_GAME_TYPE = 3;
export const GAME_LABEL: Record<string, string> = { rhythm: 'Rhythm Rush', simon: 'Simon Memory', stack: 'Stack Tower', nepa: 'Up NEPA!', ladder: 'Word Ladder', strike: 'Street Strike', nepa3d: 'UP NEPA 3D' };
/** a run at or above this counts as a win */
export const WIN_THRESHOLD: Record<string, number> = { rhythm: 350, simon: 7, stack: 50, nepa: 50, ladder: 600, strike: 80, nepa3d: 400 }; // nepa3d: the whole street lit // ladder: three of the five solved at par
export const XP_PLAYED = 10;
export const XP_WIN = 25;
export const XP_NEW_PB = 25;

// ── levels ──
/** Total XP needed to REACH a level. Each level costs 100 more than the last: 0, 100, 300, 600, 1000… */
export const totalXpForLevel = (level: number) => 50 * level * (level - 1);
export function levelFromXp(xp: number | null | undefined): number {
  const have = xp || 0;
  let lvl = 1;
  while (totalXpForLevel(lvl + 1) <= have) lvl++;
  return Math.max(1, lvl);
}
export function xpProgress(xp: number | null | undefined) {
  const level = levelFromXp(xp);
  return { level, xpInLevel: (xp || 0) - totalXpForLevel(level), xpToNext: 100 * level };
}

// ── daily missions ──
export interface RunContext { game?: string; score?: number; isWin?: boolean; isNewPb?: boolean; fullCombo?: boolean; allPerfect?: boolean }
type MissionInput = RunContext & { seenGamesToday: Set<unknown> };
export interface MissionTemplate {
  id: string; cat: 'count' | 'skill' | 'special'; label: string; target: number; reward: number;
  /** true: `match` returns the whole progress, not an amount to add */
  absolute?: boolean;
  match(run: MissionInput): number;
}
const scoreAtLeast = (game: string, min: number) => (r: MissionInput) => (r.game === game && (r.score ?? 0) >= min ? 1 : 0);
const one = () => 1;
const gamesSeen = (r: MissionInput) => r.seenGamesToday.size;
export const MISSION_TEMPLATES: MissionTemplate[] = [
  { id: 'play_3_games', cat: 'count', label: 'Play 3 games today', target: 3, reward: 20, match: one },
  { id: 'play_5_games', cat: 'count', label: 'Play 5 games today', target: 5, reward: 30, match: one },
  { id: 'play_10_games', cat: 'count', label: 'Play 10 games today', target: 10, reward: 45, match: one },
  { id: 'rhythm_30k', cat: 'skill', label: 'Score 30,000+ in Rhythm Rush', target: 1, reward: 20, match: scoreAtLeast('rhythm', 30000) },
  { id: 'rhythm_50k', cat: 'skill', label: 'Score 50,000+ in Rhythm Rush', target: 1, reward: 28, match: scoreAtLeast('rhythm', 50000) },
  { id: 'rhythm_80k', cat: 'skill', label: 'Score 80,000+ in Rhythm Rush', target: 1, reward: 35, match: scoreAtLeast('rhythm', 80000) },
  { id: 'simon_5', cat: 'skill', label: 'Reach round 5 in Simon Memory', target: 1, reward: 20, match: scoreAtLeast('simon', 5) },
  { id: 'simon_8', cat: 'skill', label: 'Reach round 8 in Simon Memory', target: 1, reward: 28, match: scoreAtLeast('simon', 8) },
  { id: 'simon_12', cat: 'skill', label: 'Reach round 12 in Simon Memory', target: 1, reward: 35, match: scoreAtLeast('simon', 12) },
  { id: 'stack_30', cat: 'skill', label: 'Stack 30+ blocks in Stack Tower', target: 1, reward: 20, match: scoreAtLeast('stack', 30) },
  { id: 'stack_45', cat: 'skill', label: 'Stack 45+ blocks in Stack Tower', target: 1, reward: 28, match: scoreAtLeast('stack', 45) },
  { id: 'stack_60', cat: 'skill', label: 'Stack 60+ blocks in Stack Tower', target: 1, reward: 35, match: scoreAtLeast('stack', 60) },
  // a Word Ladder round tops out at 1,000 (five ladders, 200 each)
  { id: 'ladder_500', cat: 'skill', label: 'Score 500+ in Word Ladder', target: 1, reward: 20, match: scoreAtLeast('ladder', 500) },
  { id: 'ladder_750', cat: 'skill', label: 'Score 750+ in Word Ladder', target: 1, reward: 28, match: scoreAtLeast('ladder', 750) },
  { id: 'ladder_900', cat: 'skill', label: 'Score 900+ in Word Ladder', target: 1, reward: 35, match: scoreAtLeast('ladder', 900) },
  // a Street Strike game tops out at 150
  { id: 'strike_60', cat: 'skill', label: 'Score 60+ in Street Strike', target: 1, reward: 20, match: scoreAtLeast('strike', 60) },
  { id: 'strike_90', cat: 'skill', label: 'Score 90+ in Street Strike', target: 1, reward: 28, match: scoreAtLeast('strike', 90) },
  { id: 'strike_120', cat: 'skill', label: 'Score 120+ in Street Strike', target: 1, reward: 35, match: scoreAtLeast('strike', 120) },
  { id: 'beat_personal_best', cat: 'special', label: 'Beat a personal best', target: 1, reward: 35, match: (r) => (r.isNewPb ? 1 : 0) },
  { id: 'variety_2', cat: 'special', absolute: true, label: 'Play 2 different games today', target: 2, reward: 25, match: gamesSeen },
  { id: 'variety_3', cat: 'special', absolute: true, label: 'Play 3 different games today', target: 3, reward: 40, match: gamesSeen },
];

/** Three missions a day, one of each kind. Seeded by wallet and date, so a
 *  player always sees the same three for the day and cannot reroll them. */
export function pickDailyMissions(wallet: string, date: string): MissionTemplate[] {
  let h = 0;
  const seed = `${wallet}-${date}`;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const rng = () => { h = Math.imul(48271, h) | 0; return (h >>> 0) / 0xffffffff; };
  const pick = (cat: MissionTemplate['cat']) => { const pool = MISSION_TEMPLATES.filter((m) => m.cat === cat); return pool[Math.floor(rng() * pool.length)]!; };
  return [pick('count'), pick('skill'), pick('special')];
}

/** New progress for a mission after a run, or null if nothing changed. */
export function advanceMission(tpl: MissionTemplate, mission: { progress: number; target: number }, run: MissionInput): { progress: number; completed: boolean } | null {
  const value = tpl.match(run);
  if (!tpl.absolute && !value) return null;
  const progress = tpl.absolute ? Math.min(mission.target, value) : Math.min(mission.target, mission.progress + value);
  if (progress === mission.progress) return null;
  return { progress, completed: progress >= mission.target };
}

// ── achievements ──
export interface AchievementInput extends RunContext { totalGames: number; playStreak: number }
export interface Achievement { id: string; icon: string; name: string; desc: string; check(c: AchievementInput): boolean }
const scored = (game: string, min: number) => (c: AchievementInput) => c.game === game && (c.score ?? 0) >= min;
export const ACHIEVEMENT_CATALOG: Achievement[] = [
  { id: 'first_win', icon: '🥇', name: 'First Win', desc: 'Win your first game', check: (c) => !!c.isWin },
  { id: 'streak_3', icon: '🔥', name: '3-Day Streak', desc: 'Play 3 days in a row', check: (c) => c.playStreak >= 3 },
  { id: 'streak_7', icon: '🔥', name: 'Week Warrior', desc: 'Play 7 days in a row', check: (c) => c.playStreak >= 7 },
  { id: 'streak_30', icon: '🔥', name: 'Month Master', desc: 'Play 30 days in a row', check: (c) => c.playStreak >= 30 },
  { id: 'games_5', icon: '🎮', name: 'Getting Started', desc: 'Play 5 games total', check: (c) => c.totalGames >= 5 },
  { id: 'games_25', icon: '🎮', name: 'Regular Player', desc: 'Play 25 games total', check: (c) => c.totalGames >= 25 },
  { id: 'games_100', icon: '💎', name: 'Veteran', desc: 'Play 100 games total', check: (c) => c.totalGames >= 100 },
  { id: 'rhythm_300', icon: '🥁', name: 'Drum Apprentice', desc: 'Score 60,000+ in Rhythm Rush', check: scored('rhythm', 60000) },
  { id: 'rhythm_500', icon: '🥁', name: 'Rhythm Master', desc: 'Score 200,000+ in Rhythm Rush', check: scored('rhythm', 200000) },
  { id: 'rhythm_700', icon: '👑', name: 'Rhythm Legend', desc: 'Score 400,000+ in Rhythm Rush', check: scored('rhythm', 400000) },
  { id: 'rhythm_fc', icon: '✨', name: 'Full Combo', desc: 'Clear the rhythm chart without missing a note', check: (c) => c.game === 'rhythm' && !!c.fullCombo },
  { id: 'rhythm_ap', icon: '🌟', name: 'All Perfect', desc: 'Every hit PERFECT — no goods, no misses', check: (c) => c.game === 'rhythm' && !!c.allPerfect },
  { id: 'simon_5', icon: '🧠', name: 'Memory Apprentice', desc: 'Reach round 5 in Simon Memory', check: scored('simon', 5) },
  { id: 'simon_10', icon: '🧠', name: 'Memory Master', desc: 'Reach round 10 in Simon Memory', check: scored('simon', 10) },
  { id: 'simon_15', icon: '👑', name: 'Memory Legend', desc: 'Reach round 15 in Simon Memory', check: scored('simon', 15) },
  { id: 'stack_50', icon: '🧱', name: 'Block Builder', desc: 'Score 50+ in Stack Tower', check: scored('stack', 50) },
  { id: 'stack_150', icon: '🏗️', name: 'Tower Master', desc: 'Score 150+ in Stack Tower', check: scored('stack', 150) },
  { id: 'stack_300', icon: '🏙️', name: 'Sky Architect', desc: 'Score 300+ in Stack Tower', check: scored('stack', 300) },
];

// ── badges ──
/** Longest run of consecutive seasons a player took gold in one game. */
export function goldStreak(seasons: number[]): number {
  const s = [...seasons].sort((a, b) => a - b);
  let best = s.length >= 1 ? 1 : 0, cur = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]! + 1) { cur++; best = Math.max(best, cur); } else cur = 1;
  }
  return best;
}

// ── dates ──
/** The UTC calendar day, e.g. "2026-11-23". Missions and streaks reset on it. */
export const utcDay = (ms: number) => new Date(ms).toISOString().split('T')[0]!;
export const DAY_MS = 86_400_000;
