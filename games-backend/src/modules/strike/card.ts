// ─── A bowling card, as pure rules ───────────────────────────────────────────
// No server, no storage, no clock: just "is this list of rolls a legal game, and
// is it finished?". Everything else in the module leans on this, and it is the
// part that must never be wrong, so it is the part with the most tests.

export const FRAMES = 5;
export const PINS = 10;

export interface CardState { done: boolean; /** index of the frame being bowled; FRAMES when done */ frame: number }

const pin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= PINS;

/** Walk a list of rolls as a bowling card. Returns null if it is not a legal one. */
export function readCard(rolls: unknown, frames = FRAMES): CardState | null {
  if (!Array.isArray(rolls) || rolls.length > frames * 2 + 1) return null;
  let i = 0;
  for (let f = 0; f < frames; f++) {
    if (i >= rolls.length) return { done: false, frame: f };
    const a: unknown = rolls[i];
    if (!pin(a)) return null;
    if (f < frames - 1) {
      if (a === PINS) { i += 1; continue; }
      if (i + 1 >= rolls.length) return { done: false, frame: f };
      const b: unknown = rolls[i + 1];
      if (!pin(b) || a + b > PINS) return null;
      i += 2;
      continue;
    }
    // last frame: a strike or a spare earns one more roll
    if (i + 1 >= rolls.length) return { done: false, frame: f };
    const b: unknown = rolls[i + 1];
    if (!pin(b)) return null;
    if (a < PINS && a + b > PINS) return null;
    if (a !== PINS && a + b !== PINS) return i + 2 === rolls.length ? { done: true, frame: frames } : null;
    if (i + 2 >= rolls.length) return { done: false, frame: f };
    const c: unknown = rolls[i + 2];
    if (!pin(c)) return null;
    if (a === PINS && b < PINS && b + c > PINS) return null;
    return i + 3 === rolls.length ? { done: true, frame: frames } : null;
  }
  return i === rolls.length ? { done: true, frame: frames } : null;
}

/** Letters, digits and a little punctuation; trimmed; never empty. */
export function cleanName(raw: unknown): string {
  // Marks are kept: Yoruba and Igbo names carry tone and dot-below marks ("Ẹ̀kọ́").
  // Cut by whole characters, never through the middle of one, then trim again.
  const kept = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{M}\p{N} _.\-]/gu, '').trim();
  const s = Array.from(kept).slice(0, 14).join('').trim();
  return s || 'Player';
}
