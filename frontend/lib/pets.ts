// ─── Pet stages — single source of truth ─────────────────────────────────────
// The same data was copy-pasted into profile, rhythm, simon and challenge-ai.
// New surfaces (games hub pet widget) import from here; existing pages can
// migrate over time without behavior change.

export type PetStage = {
  id: string;
  name: string;
  src: string;
  minLevel: number;
  color: string;
};

export const PET_STAGES: PetStage[] = [
  { id: "egg",     name: "Mystery Egg",   src: "/pets/stage-1-egg.png",     minLevel: 1,  color: "#e2e8f0" },
  { id: "baby",    name: "Baby Slime",    src: "/pets/stage-2-baby.png",    minLevel: 5,  color: "#22c55e" },
  { id: "teen",    name: "Teen Slime",    src: "/pets/stage-3-teen.png",    minLevel: 15, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, color: "#06b6d4" },
  { id: "king",    name: "King Slime",    src: "/pets/stage-5-king.png",    minLevel: 50, color: "#fbbf24" },
];

export function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

// ─── Moods ───────────────────────────────────────────────────────────────────
// Every slime has five faces, rendered from the same model so they line up
// exactly (tools/blender/build_pets.py). The egg has no face yet.
//   happy   the resting face           blink   eyes shut for a moment
//   joy     a win, a poke, a level up  sad     the streak is about to break
//   sleepy  nobody has played for a while
export type PetMood = "happy" | "blink" | "joy" | "sad" | "sleepy";

/** The picture for a stage and a mood. `small` is a 128px copy for avatars. */
export function petFrame(stage: { id: string }, mood: PetMood = "happy", small = false): string {
  const m = stage.id === "egg" ? "happy" : mood;
  return `/pets/m/${stage.id}-${m}${small ? "-s" : ""}.webp`;
}

/** How the pet feels when nothing is happening, from what the player has done.
 *  Played today: happy. A streak that today would break: sad. Nothing to lose and no play: asleep. */
export function restingMood(p: { playedToday: boolean; streak: number } | null | undefined): "happy" | "sad" | "sleepy" {
  if (!p || p.playedToday) return "happy";
  return p.streak > 0 ? "sad" : "sleepy";
}

/** One line that says why the pet looks the way it does, and what fixes it. */
export function moodLine(name: string, p: { playedToday: boolean; streak: number } | null | undefined): string {
  const mood = restingMood(p);
  if (mood === "sad") return `${name} misses you. Play one game today to keep your ${p!.streak} day streak.`;
  if (mood === "sleepy") return `${name} is asleep. Play a game to wake it up.`;
  return p && p.streak > 1 ? `${name} is happy. ${p.streak} days in a row.` : `${name} is happy. You played today.`;
}

/** Fetch a stage's faces ahead of time, so the first reaction in a game does not wait on the network. */
export function preloadPetFaces(stage: { id: string }, moods: PetMood[] = ["happy", "joy", "sad"]): void {
  if (typeof window === "undefined" || stage.id === "egg") return;
  for (const m of moods) { const im = new Image(); im.decoding = "async"; im.src = petFrame(stage, m); }
}
