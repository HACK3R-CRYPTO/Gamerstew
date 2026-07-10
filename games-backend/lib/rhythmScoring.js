// ─── rhythmScoring.js ────────────────────────────────────────────────────────
// Server-side replica of the Rhythm Rush chart + scoring rules. Used by
// /api/sign-score to replay a player's tap log and compute the authoritative
// score (instead of trusting whatever number the client claims).
//
// MUST stay in sync with frontend/app/games/rhythm/page.tsx — same constants,
// same chart, same combo math. If you tighten PERFECT_WINDOW or change combo
// progression on the client, update this file too or real players will get
// rejected.

const PERFECT_WINDOW  = 0.08;      // ±80ms — skill threshold
const GOOD_WINDOW     = 0.28;      // ±280ms — casual safety net
const BPM             = 120;
const BEAT            = 60 / BPM;
const TRACK_DURATION  = 45;        // seconds — main track length

const TRAVEL_INTRO = 2.5;
const TRAVEL_VERSE = 2.1;
const TRAVEL_BUILD = 1.7;
const TRAVEL_DROP  = 1.4;

// Turkish March / Rondo alla Turca (Mozart) — A minor pitches
const P_GS4 = 415.30, P_A4 = 440.00, P_B4 = 493.88, P_C5 = 523.25,
      P_D5 = 587.33, P_DS5 = 622.25, P_E5 = 659.25, P_F5 = 698.46;

const laneFor = (f) => {
  if (f === P_GS4 || f === P_A4) return 0;
  if (f === P_B4 || f === P_C5) return 1;
  if (f === P_D5 || f === P_DS5) return 2;
  return 3; // E5 / F5
};

// Hold-note math — MUST mirror the client (page.tsx). Complete-or-break:
// the bar must be held until note.time + hold (minus the release grace).
// Complete = full bonus. Early release = no bonus + streak/fever break.
const HOLD_TICK_POINTS = 2;      // per 0.5s of bar length, paid on completion
const HOLD_TICK_SEC = 0.5;
const HOLD_RELEASE_GRACE = 0.15;

// Build the main-track chart. Deterministic — no seed needed since the chart
// is the same every game. The encore is built dynamically by the client; we
// reconstruct it from the tap log timing (see computeScore below).
// Phrase entries are [pitch, holdSeconds?] — mirrors page.tsx exactly.
function buildMainChart() {
  const notes = [];
  let id = 0;
  const push = (lane, time, travel, freq, hold) =>
    notes.push({ id: id++, lane, time, travel, freq, ...(hold ? { hold } : {}) });

  const T1 = [[P_B4], [P_A4], [P_GS4], [P_A4], [P_C5, 1.0]];
  const T2 = [[P_D5], [P_C5], [P_B4], [P_C5], [P_E5, 1.0]];
  const T3 = [[P_F5], [P_E5], [P_DS5], [P_E5], [P_B4], [P_A4], [P_GS4], [P_A4]];
  const T4 = [[P_C5], [P_B4], [P_A4, 1.5]];

  const stamp = (phrase, start, travel, step = BEAT) => {
    phrase.forEach(([f, hold], i) => push(laneFor(f), start + i * step, travel, f, hold));
  };
  const stampTapsOnly = (phrase, start, travel, step) => {
    phrase.forEach(([f], i) => push(laneFor(f), start + i * step, travel, f));
  };

  // Explicit start times copied from page.tsx buildChart().
  stamp(T1, 4.0,  TRAVEL_INTRO);
  stamp(T2, 7.5,  TRAVEL_INTRO);
  stamp(T3, 11.0, TRAVEL_VERSE);
  stamp(T4, 15.5, TRAVEL_VERSE);
  stamp(T1, 18.5, TRAVEL_VERSE);
  stamp(T2, 22.0, TRAVEL_BUILD);
  stamp(T3, 25.5, TRAVEL_BUILD);
  stamp(T4, 30.0, TRAVEL_DROP);
  stampTapsOnly(T3, 32.5, TRAVEL_DROP, BEAT / 2); // eighth-note climax sprint

  // Outro — four held tonic A's (1.0s holds) at slowing intervals
  for (const t of [36.0, 38.0, 40.0, 42.5]) {
    push(laneFor(P_A4), t, TRAVEL_BUILD, P_A4, 1.0);
  }

  return notes.sort((a, b) => a.time - b.time);
}

// ─── Physics check ───────────────────────────────────────────────────────────
// Cheap timing-physics gates that run BEFORE the replay. Reject obvious bots.
// Hold-note RELEASE events (`up: 1`) are validated for shape but excluded
// from the human-speed gates: a press+release pair on one lane is a single
// physical gesture, and its intra-gesture gap says nothing about tap rate.
function physicsCheck(tapLog, elapsedMs) {
  if (!Array.isArray(tapLog)) return { ok: false, reason: 'Tap log missing' };

  // Lane/time validity — every entry, presses and releases alike.
  for (const tap of tapLog) {
    if (!Number.isInteger(tap.lane) || tap.lane < 0 || tap.lane > 3) {
      return { ok: false, reason: 'Invalid lane' };
    }
    if (typeof tap.time !== 'number' || tap.time < 0) {
      return { ok: false, reason: 'Invalid tap time' };
    }
  }

  const presses = tapLog.filter(t => !t.up);
  if (presses.length === 0) return { ok: false, reason: 'No taps recorded' };

  // Bounded session length — Rhythm Rush capped at 10 minutes even in encore
  // (real players never survive that long). Anything past = suspicious.
  if (elapsedMs > 10 * 60 * 1000) {
    return { ok: false, reason: 'Session too long' };
  }

  // Inter-tap gap — only enforce on SAME-LANE consecutive PRESSES. Two-finger
  // mobile play legitimately fires cross-lane touch events 10-25ms apart;
  // the sustained-rate gate below still catches real bot patterns.
  for (let i = 1; i < presses.length; i++) {
    const gap = presses[i].time - presses[i - 1].time;
    if (gap < 0) return { ok: false, reason: 'Tap log out of order' };
    if (presses[i].lane === presses[i - 1].lane && gap < 0.030) {
      return { ok: false, reason: 'Taps too fast for human' };
    }
  }

  // Sustained APM — no sliding 1-second window can have more than 12 presses
  let windowStart = 0;
  for (let i = 0; i < presses.length; i++) {
    while (presses[i].time - presses[windowStart].time > 1.0) windowStart++;
    if (i - windowStart + 1 > 12) {
      return { ok: false, reason: 'Sustained tap rate inhuman' };
    }
  }

  return { ok: true };
}

// ─── Jitter check ────────────────────────────────────────────────────────────
// Catches "constructed perfect tap log" attacks. Real human play has timing
// variance; synthesized perfect taps don't. We compute the precision distribution
// of hits AFTER the replay and reject inhuman patterns.
//
// Only main-track hits are analyzed. Encore notes are dynamically spawned
// client-side and the server marks every encore hit with diff=0 (since it
// can't reconstruct the dynamic spawn timing). Including encore hits in
// the analysis would flag real long-encore survivors as bots — they'd
// accumulate too many "sub-5ms" entries just from playing encore. Main-track
// hits already give us a strong signal: a cheater has to fake those too,
// and faking main-track hits requires hitting the timing windows we can verify.
function jitterCheck(hits) {
  const mainHits = hits.filter(h => !h.encore);
  if (mainHits.length < 10) return { ok: true }; // too few to analyze

  let zeroish = 0;
  let totalDiff = 0;
  for (const h of mainHits) {
    totalDiff += h.diff;
    if (h.diff < 0.005) zeroish++; // sub-5ms is inhuman precision
  }
  const avgDiff = totalDiff / mainHits.length;
  const zeroishRatio = zeroish / mainHits.length;

  // Hard reject — almost every tap at sub-5ms diff means a bot
  if (zeroishRatio > 0.7) {
    return { ok: false, reason: 'Inhuman timing precision' };
  }
  // Hard reject — average diff below 15ms across long sessions means a bot
  if (mainHits.length > 50 && avgDiff < 0.015) {
    return { ok: false, reason: 'Timing too precise to be human' };
  }

  // Variance check — humans have a spread of timing errors
  let varianceSum = 0;
  for (const h of mainHits) varianceSum += (h.diff - avgDiff) ** 2;
  const variance = varianceSum / mainHits.length;
  if (mainHits.length > 30 && variance < 0.0001) {
    return { ok: false, reason: 'Timing has no human variance' };
  }

  return { ok: true };
}

// ─── computeScore · Scoring 2.0 — addition only ──────────────────────────────
// Mirrors the client's rewritten math EXACTLY (page.tsx hitLane):
//   · Perfect = 10, Good = 5, flat. NO combo multiplier, NO precision bonus.
//   · FEVER is the only multiplier: 12 consecutive main-track PERFECTs ignite
//     ×2 for 6 seconds. The igniting tap itself is NOT doubled. A GOOD breaks
//     the perfect streak (fever keeps burning); a miss kills streak AND fever.
//   · Encore taps (t >= TRACK_DURATION) pay a flat 5. No fever in encore.
//   · No caps. The finite chart + the encore's accelerating speed wall bound
//     the score naturally — a legit ceiling around ~1,500, not a clamp.
//
// Trade-off: a cheater could fabricate encore taps, but each one is worth a
// flat 5 and is still bounded by the physics + jitter checks, so the math
// ceiling for elapsed time equals the real-player ceiling.
const FEVER_TRIGGER = 12;
const FEVER_DURATION = 6;
const FEVER_MULT = 2;
const ENCORE_POINTS = 5;

function computeScore(tapLog, elapsedMs) {
  const chart = buildMainChart();
  let score = 0;
  let perfectStreak = 0;
  let feverUntil = 0;              // song-time expiry · 0 = off
  const consumed = new Set();
  const hits = []; // for jitter analysis

  // Split presses from hold-releases. Presses drive hit judgment; each
  // hold-note press pairs with the NEXT same-lane release to credit
  // sustain ticks (same math as the client's resolveHold).
  const events = [...tapLog].sort((a, b) => a.time - b.time);
  const taps = events.filter(t => !t.up);
  const releases = events.filter(t => t.up);
  const usedReleases = new Set();
  const nextReleaseAfter = (lane, t) => {
    for (let i = 0; i < releases.length; i++) {
      if (usedReleases.has(i)) continue;
      if (releases[i].lane === lane && releases[i].time > t) {
        usedReleases.add(i);
        return releases[i];
      }
    }
    return null;
  };
  const notesByTime = [...chart].sort((a, b) => a.time - b.time);

  // Miss sweep — the client kills the perfect streak and fever the moment a
  // note expires unhit (RAF miss loop). The server can't see non-taps, so
  // before scoring each tap it sweeps every note whose good-window closed
  // earlier and was never consumed: each one is a miss that resets state.
  let sweepIdx = 0;
  const sweepMissesBefore = (t) => {
    while (sweepIdx < notesByTime.length) {
      const n = notesByTime[sweepIdx];
      if (n.time + GOOD_WINDOW >= t) break;
      if (!consumed.has(n.id)) {
        perfectStreak = 0;
        feverUntil = 0;
      }
      sweepIdx++;
    }
  };

  for (const tap of taps) {
    sweepMissesBefore(tap.time);

    // Try to match this tap to an unconsumed main-track note in the same lane
    let bestNote = null;
    let bestDiff = Infinity;
    for (const note of chart) {
      if (note.lane !== tap.lane) continue;
      if (consumed.has(note.id)) continue;
      const diff = Math.abs(tap.time - note.time);
      if (diff > GOOD_WINDOW) continue;
      if (diff < bestDiff) { bestDiff = diff; bestNote = note; }
    }

    if (bestNote) {
      consumed.add(bestNote.id);
      const isPerfect = bestDiff <= PERFECT_WINDOW;
      const base = isPerfect ? 10 : 5;
      const inFever = feverUntil > 0 && tap.time < feverUntil;
      score += inFever ? base * FEVER_MULT : base;

      if (isPerfect) {
        perfectStreak++;
        if (!inFever && perfectStreak >= FEVER_TRIGGER) {
          feverUntil = tap.time + FEVER_DURATION;
          perfectStreak = 0;
        }
      } else {
        perfectStreak = 0; // GOOD breaks the chain; fever keeps burning
      }
      hits.push({ diff: bestDiff, isPerfect });

      // Hold sustain — complete-or-break, mirroring the client exactly.
      // Pair with the next same-lane release: released at/after the bar's
      // end (minus grace) = full bonus; early = no bonus AND the streak +
      // fever break (the client fires DROPPED). No release logged = no
      // bonus (the client always logs one, including auto-completion).
      if (bestNote.hold) {
        const rel = nextReleaseAfter(bestNote.lane, tap.time);
        const endTime = bestNote.time + bestNote.hold;
        if (rel && rel.time >= endTime - HOLD_RELEASE_GRACE) {
          score += Math.floor(bestNote.hold / HOLD_TICK_SEC) * HOLD_TICK_POINTS;
        } else {
          perfectStreak = 0;
          feverUntil = 0;
        }
      }
      continue;
    }

    // Encore territory — flat points, no fever, no streak bookkeeping.
    if (tap.time >= TRACK_DURATION) {
      score += ENCORE_POINTS;
      hits.push({ diff: 0, isPerfect: true, encore: true });
      continue;
    }

    // Stray tap in main-track time with no matching note = a miss on the
    // client (combo/streak/fever all reset). Mirror that.
    perfectStreak = 0;
    feverUntil = 0;
  }

  return { score, hits };
}

module.exports = {
  PERFECT_WINDOW,
  GOOD_WINDOW,
  TRACK_DURATION,
  buildMainChart,
  physicsCheck,
  jitterCheck,
  computeScore,
};
