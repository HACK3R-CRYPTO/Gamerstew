"use client";

// ─── RestoreDirector — Restore the Light's per-frame brain (no geometry) ─────
// Runs only in restore mode. Starts the scene in blackout, then each frame:
// ticks the clock; activates any power point the player is standing on; drives
// the GLOBAL light level up with the fraction of points restored (so the whole
// street brightens as you go); and ends the round on a full restore or time-out.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { worldControls } from "./controls";
import { playStreetCheer, playHit, playMiss, playWarn, playClutch, playNepaUp, playCheer, setBedLevel } from "./audio";
import { useFx } from "./fx";
import { useShout, pick, LINES } from "./shout";
import {
  TAP_GRACE,
  POWER_POINTS,
  pointState,
  ACTIVATE_RADIUS,
  BLACKOUT_LEVEL,
  restoreScore,
  restoreParts,
  timing,
  armTiming,
  resetTiming,
  useRestoreStore,
  DECAY_START_FRAC,
  WARN_TIME,
  CRITICAL_TIME,
  CLUTCH_WINDOW,
  CLUTCH_BONUS,
  SAVE_BONUS,
  nextDecayDelay,
  BROWNOUT_PER_UNIT,
  BROWNOUT_DRAIN,
  BROWNOUT_LULL,
  CHAIN_WINDOW,
  CHAIN_BASE,
  CHAIN_CAP,
  MEGASURGE_HOLD,
  MEGASURGE_BONUS,
  MEGA_MAX_WARN,
  megaDecayDelay,
  intensity,
  VIP_INDEX,
  RAID_MIN_FRAC,
  nextRaidDelay,
  raidSize,
  BROWNOUT_TRIP_JOLT,
} from "./restore";

const R2 = ACTIVATE_RADIUS * ACTIVATE_RADIUS;

export default function RestoreDirector() {
  const push = useRef(0);
  const elapsed = useRef(0);
  const restored = useRef(0);
  const perfects = useRef(0);
  const blessing = useRef<{ idx: number; t: number } | null>(null); // a bonus light about to land
  const pStreak = useRef(0);
  const perfectBonus = useRef(0);
  const prevMode = useRef<string>("idle");
  const brownout = useRef(0); // 0..1 grid-pressure meter (fills while breakers sit dark)
  const saves = useRef(0); // breakers rescued from a warning
  const saveBonus = useRef(0); // accumulated stabilise/clutch score, folded into the win
  const lull = useRef(0); // seconds of post-blackout calm left (no new decay)
  const freeze = useRef(0); // seconds of 🔧 STABILISER left (pickup): decay fully paused
  const roadT = useRef(0); // seconds spent standing in the traffic lanes
  const roadWarned = useRef(false); // have we shouted "comot for road" this stint
  const chain = useRef(0); // flip-chain count (fast consecutive flips)
  const lastFlip = useRef(-999); // elapsed time of the last flip (for the chain window)
  const chainBonus = useRef(0); // accumulated chain score, folded into the win
  const megaOn = useRef(false); // the MEGA-SURGE finale is running
  const megaHeld = useRef(0); // seconds the FULL street has been held during the finale
  const raidCd = useRef(999); // seconds to the next NEPA raid (set once raids unlock)
  const raids = useRef(0); // count of raids fired (bumps the HUD raid banner)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const store = useRestoreStore.getState();

    if (store.mode === "playing" && prevMode.current !== "playing") {
      elapsed.current = 0;
      restored.current = 0;
      blessing.current = null;
      perfects.current = 0;
      pStreak.current = 0;
      perfectBonus.current = 0;
      push.current = 0;
      brownout.current = 0;
      saves.current = 0;
      saveBonus.current = 0;
      lull.current = 0;
      freeze.current = 0;
      roadT.current = 0;
      roadWarned.current = false;
      chain.current = 0;
      lastFlip.current = -999;
      chainBonus.current = 0;
      megaOn.current = false;
      megaHeld.current = 0;
      raidCd.current = 999;
      raids.current = 0;
      resetTiming();
      worldControls.lit = BLACKOUT_LEVEL; // snap to blackout at the start
    }
    prevMode.current = store.mode;

    const total = POWER_POINTS.length;
    // Decay re-roll: fast + staggered during the MEGA-SURGE finale; otherwise it
    // scales with BOTH coverage and the time-pressure (the night getting late).
    const decayRoll = () => (megaOn.current ? megaDecayDelay() : nextDecayDelay(restored.current / total, intensity(elapsed.current)));

    if (store.mode !== "playing") {
      resetTiming();
      // Keep the scene lit on the menu / result screens.
      const want = store.mode === "won" ? 1 : store.mode === "over" ? restored.current / total : 1;
      worldControls.lit += (Math.max(BLACKOUT_LEVEL, want) - worldControls.lit) * Math.min(1, dt * 4);
      return;
    }

    // Scored clock counts a less-clamped delta (0.25s cap, vs 0.1s for physics)
    // so a low-fps client can't badly under-count real time and game the
    // fastest-time leaderboard — but the cap still rejects the multi-second
    // spike of the first frame after a mode switch / tab stall, which would
    // otherwise blow past MAX_TIME and end the run the instant you press Play.
    elapsed.current += Math.min(rawDt, 0.25);

    // ── GAME OVER: the road wins when your last heart is gone ───────────────
    // Lives are spent by car hits (Traffic.tsx). When they run out, NEPA keeps
    // the night — end the run with partial (coverage) credit.
    if (store.lives <= 0) {
      resetTiming();
      worldControls.guide.active = false;
      worldControls.shake = 0.4;
      playMiss(0);
      useFx.getState().shock();
      useShout.getState().shout(pick(LINES.lose), "bad");
      store.finish({
        restored: restored.current,
        total,
        timeTaken: null,
        won: false,
        score: restoreScore(restored.current, total, null, perfectBonus.current + saveBonus.current),
        parts: restoreParts(restored.current, total, null, perfectBonus.current + saveBonus.current),
      });
      return;
    }

    const p = worldControls.playerPos;

    // ── Pickups (Restore): apply the grabbed power-up (restored/lives live here). ──
    if (worldControls.pickup) {
      const k = worldControls.pickup;
      worldControls.pickup = null;
      if (k === "stabilizer") {
        freeze.current = 5;
        useShout.getState().shout("🔧 STABILISED! decay frozen 5s", "big");
      } else if (k === "jumpstart") {
        // Light the 2 nearest still-dark breakers for free.
        const dark: number[] = [];
        for (let i = 0; i < total; i++) if (!pointState[i].on) dark.push(i);
        dark.sort((a, b) =>
          ((p.x - POWER_POINTS[a][0]) ** 2 + (p.z - POWER_POINTS[a][1]) ** 2) -
          ((p.x - POWER_POINTS[b][0]) ** 2 + (p.z - POWER_POINTS[b][1]) ** 2));
        for (let n = 0; n < Math.min(2, dark.length); n++) {
          const i = dark[n];
          const st = pointState[i];
          st.on = true; st.flash = 1; st.warnT = 0; st.lost = false;
          st.decayCd = decayRoll();
          restored.current += 1;
        }
        playClutch(0);
        useShout.getState().shout("💡 JUMP-START! +2 lit", "big");
      } else if (k === "life") {
        store.setLive({ lives: store.lives + 1 });
        useShout.getState().shout("❤️ Extra life!", "good");
      }
    }
    if (freeze.current > 0) freeze.current = Math.max(0, freeze.current - dt);

    let nearIdx: number | null = null;
    let nearD2 = Infinity;
    let guideIdx: number | null = null;
    let guideD2 = Infinity;
    let guideWarn = false; // does the guide point at a dying breaker (urgent) vs an unlit one?

    for (let i = 0; i < POWER_POINTS.length; i++) {
      const st = pointState[i];
      if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * 1.8);
      const dx = p.x - POWER_POINTS[i][0];
      const dz = p.z - POWER_POINTS[i][1];
      const d2 = dx * dx + dz * dz;
      // A breaker is a TARGET if it's unlit (flip it) OR lit-but-warning (save it).
      const isTarget = !st.on || st.warnT > 0;
      if (isTarget) {
        // nearest in range = the one you're lined up on (for the timing meter)
        if (d2 <= R2 && d2 < nearD2) {
          nearD2 = d2;
          nearIdx = i;
        }
        // Guidance prefers a DYING breaker (warnT>0): a warning breaker always
        // out-ranks an unlit one so the arrow screams "go save that" over "go light
        // a new one". Among same urgency, nearest wins.
        const score = d2 - (st.warnT > 0 ? 1e6 : 0);
        if (score < guideD2) {
          guideD2 = score;
          guideIdx = i;
          guideWarn = st.warnT > 0;
        }
      }
    }
    // While driving the keke you can't flip/save — it's pure fast traversal; hop
    // off (GET OFF) to act. Disarms the meter + hides the FLIP/SAVE button.
    if (worldControls.driving) nearIdx = null;
    const nearWarn = nearIdx != null && pointState[nearIdx].warnT > 0;

    // Guidance arrow points at the most urgent target (hidden once close).
    const guideRealD2 = guideIdx != null ? (POWER_POINTS[guideIdx][0] - p.x) ** 2 + (POWER_POINTS[guideIdx][1] - p.z) ** 2 : Infinity;
    if (guideIdx != null && (guideWarn || guideRealD2 > 9)) {
      worldControls.guide.x = POWER_POINTS[guideIdx][0];
      worldControls.guide.z = POWER_POINTS[guideIdx][1];
      worldControls.guide.active = true;
    } else {
      worldControls.guide.active = false;
    }

    // ── Timing skill-check: you must TAP in the green to throw the switch ──
    if (nearIdx !== timing.activeIdx) {
      if (nearIdx != null) {
        armTiming(nearIdx, restored.current / total);
        // Guided first rep: on your very first breaker of a run, the needle is
        // extra slow and the green extra wide so you learn the tap by doing it
        // (teach-by-playing, no wall of text).
        if (restored.current === 0) {
          timing.speed *= 0.6;
          timing.sweetW = Math.min(0.4, timing.sweetW * 1.5);
        }
      } else resetTiming();
    }
    // A pending NEPA blessing lands half a second after the flip that earned it:
    // the gap is the anticipation, then the second light comes on with its own
    // note, flash and shout.
    if (blessing.current) {
      blessing.current.t -= dt;
      if (blessing.current.t <= 0) {
        const bi = blessing.current.idx;
        blessing.current = null;
        const bs = pointState[bi];
        if (!bs.on) {
          bs.on = true;
          bs.flash = 1;
          bs.warnT = 0;
          bs.lost = false;
          bs.decayCd = decayRoll();
          restored.current += 1;
          worldControls.surge = 1;
          const bpan = Math.max(-1, Math.min(1, POWER_POINTS[bi][0] / 6));
          playHit(true, 0, bpan, restored.current - 1);
          playStreetCheer(restored.current / POWER_POINTS.length, bpan);
          useFx.getState().flash(true);
          useShout.getState().shout("🙌 NEPA BLESS YOU! +1 light", "big");
        }
      }
    }
    timing.result = Math.max(0, timing.result - dt * 2.5);
    timing.miss = Math.max(0, timing.miss - dt * 3);
    if (timing.activeIdx != null) {
      if (timing.lock > 0) {
        timing.lock = Math.max(0, timing.lock - dt);
      } else {
        // sweep the marker 0→1→0
        timing.needle += timing.dir * timing.speed * dt;
        if (timing.needle >= 1) {
          timing.needle = 1;
          timing.dir = -1;
        } else if (timing.needle <= 0) {
          timing.needle = 0;
          timing.dir = 1;
        }
      }
      if (worldControls.actionTap) {
        worldControls.actionTap = false;
        if (timing.lock <= 0) {
          const d = Math.abs(timing.needle - timing.sweetC);
          const pan = Math.max(-1, Math.min(1, POWER_POINTS[timing.activeIdx][0] / 6)); // stereo toward the breaker
          // Late-tap forgiveness, in meter units at the current sweep speed.
          if (d <= timing.sweetW + timing.speed * TAP_GRACE) {
            // Hit. A breaker you're on is EITHER unlit (flip it to restore) OR
            // already-lit-but-warning (stabilise it to save it). Same tap, two jobs.
            const idx = timing.activeIdx;
            const st = pointState[idx];
            const isSave = st.on && st.warnT > 0;
            const perfect = d <= Math.max(timing.sweetW * 0.34, timing.speed * 0.04); // ≥ ~80 ms wide
            if (isSave) {
              // STABILISE a dying breaker — the lit count doesn't change; you held
              // the line. Saving in the last breath (CLUTCH_WINDOW) pays a big bonus.
              const clutch = st.warnT <= CLUTCH_WINDOW;
              st.warnT = 0;
              st.decayCd = decayRoll();
              st.flash = 1;
              saves.current += 1;
              saveBonus.current += clutch ? CLUTCH_BONUS : SAVE_BONUS;
              worldControls.surge = 0.6;
              if (clutch) playClutch(pan);
              useShout.getState().shout(clutch ? "⚡ CLUTCH SAVE!" : "Held am! 💡", clutch ? "big" : "good");
            } else {
              // FLIP an unlit breaker — light it and start ITS decay clock ticking.
              st.on = true;
              st.flash = 1;
              st.warnT = 0;
              st.lost = false; // (re)lighting clears any tripped flag
              st.decayCd = decayRoll();
              restored.current += 1;
              worldControls.surge = 1;
              // FLIP CHAIN: back-to-back flips stack a growing routing bonus.
              if (elapsed.current - lastFlip.current <= CHAIN_WINDOW) chain.current += 1;
              else chain.current = 1;
              lastFlip.current = elapsed.current;
              chainBonus.current += CHAIN_BASE * Math.min(chain.current, CHAIN_CAP);
              if (chain.current === 3 || chain.current === 5 || chain.current === 8) {
                useShout.getState().shout(`⚡ CHAIN ×${chain.current}!`, "big");
              }
            }
            if (perfect) {
              perfects.current += 1;
              pStreak.current += 1;
              perfectBonus.current += 10 * Math.min(pStreak.current, 6); // streak pays more
            } else {
              pStreak.current = 0; // a non-perfect hit breaks the perfect streak
            }
            timing.result = perfect ? 2 : 1;
            playHit(perfect, pStreak.current, pan, isSave ? -1 : restored.current - 1);
            if (!isSave) {
              const total = POWER_POINTS.length;
              // The street answers every breaker: the neighbours cheer, louder as
              // more of the area has light.
              playStreetCheer(restored.current / total, pan);
              // NEPA BLESSING — the surprise. Rewards that arrive exactly as
              // expected stop registering; an unexpected extra is what lands. So
              // sometimes the surge you just threw carries down the line and the
              // NEXT breaker comes on by itself. Skill raises the odds (a PERFECT
              // is 3x likelier), so it is earned luck, not a slot machine. Never
              // on the last breaker: the final flip is always yours.
              const left = total - restored.current;
              if (left >= 2 && Math.random() < (perfect ? 0.3 : 0.1)) {
                let best = -1;
                let bestD = Infinity;
                for (let j = 0; j < total; j++) {
                  if (pointState[j].on) continue;
                  const dj = Math.hypot(POWER_POINTS[j][0] - POWER_POINTS[idx][0], POWER_POINTS[j][1] - POWER_POINTS[idx][1]);
                  if (dj < bestD) {
                    bestD = dj;
                    best = j;
                  }
                }
                if (best >= 0) blessing.current = { idx: best, t: 0.55 }; // lands a beat later
              }
            }
            worldControls.shake = perfect ? 0.3 : 0.14;
            worldControls.gestureFace.x = POWER_POINTS[idx][0];
            worldControls.gestureFace.z = POWER_POINTS[idx][1];
            worldControls.gesture = true; // the character turns + reaches to flip it
            useFx.getState().flash(perfect);
            if (!isSave && perfect && (pStreak.current === 3 || pStreak.current === 5 || pStreak.current === 8)) {
              useShout.getState().shout(pick(LINES.combo), "big");
            } else if (!isSave && perfect) {
              useShout.getState().shout(pick(LINES.perfect), "good");
            }
            // activeIdx clears next frame (this breaker is no longer a near target)
          } else {
            // Miss — you grab the live breaker wrong and NEPA shocks you: blue
            // spark + the electrocution jolt. A miss costs TIME (a short lockout,
            // longer the further off you were) and your perfect streak — never a
            // life. In a speedrun, lost time already is the punishment, and a
            // life lost to a mistimed thumb reads as the phone's fault, not yours.
            const hardMiss = d > timing.sweetW + 0.2;
            timing.miss = 1;
            timing.lock = hardMiss ? 0.5 : 0.28;
            pStreak.current = 0;
            playMiss(pan);
            worldControls.zap = true; // blue flicker glow accent
            worldControls.react = "shock"; // full Being-Electrocuted reaction
            worldControls.shake = hardMiss ? 0.32 : 0.24;
            useFx.getState().shock(); // blue screen flash
            useShout.getState().shout(pick(LINES.shock), "bad");
          }
        }
      }
    } else {
      worldControls.actionTap = false; // ignore taps away from a breaker
    }

    // Global light rises with the restored fraction — the city comes alive.
    const frac = restored.current / total;
    const inten = intensity(elapsed.current); // 0..1 time-pressure (the night getting late)
    const targetLit = BLACKOUT_LEVEL + (1 - BLACKOUT_LEVEL) * frac;
    worldControls.lit += (targetLit - worldControls.lit) * Math.min(1, dt * 5);
    worldControls.surge += (0 - worldControls.surge) * (1 - Math.exp(-2.4 * dt));
    if (worldControls.surge < 0.001) worldControls.surge = 0;

    // ── TRIAGE: breakers destabilise, warn, then trip — hold the line ──────
    // Each lit breaker runs its OWN decay clock. When it expires the breaker enters
    // a visible WARNING (warnT counts down, amber→red); run back and re-tap it to
    // SAVE it, or it TRIPS back to dark and you have to re-flip it from scratch.
    // Several can be dying at once, so you must choose which to save. New
    // destabilisations pause during a post-blackout LULL and stop once you're one
    // breaker from done, so the final flip is always a clean grab.
    if (lull.current > 0) lull.current = Math.max(0, lull.current - dt);
    // 🔧 STABILISER (pickup): while frozen, nothing decays, warnings pause, and the
    // grid counts as stable so the brownout meter drains — a breather you earn.
    const frozen = freeze.current > 0;
    // During the MEGA-SURGE finale every lit breaker is fair game (the whole street
    // is lit, so the normal "stop one-from-done" guard would freeze the assault).
    // A 🔧 STABILISER pickup still buys a breather, even in the finale.
    const canDestabilise = !frozen && (megaOn.current
      ? true
      : frac >= DECAY_START_FRAC && restored.current < total - 1 && lull.current <= 0);

    let unstable = 0; // dark + warning breakers — the brownout pressure
    let anyCritical = false;
    // Finale only: how many breakers are already dying, so we can cap new ones.
    let warnActive = 0;
    if (megaOn.current) for (let i = 0; i < total; i++) if (pointState[i].on && pointState[i].warnT > 0) warnActive += 1;
    for (let i = 0; i < total; i++) {
      const st = pointState[i];
      if (st.on) {
        if (st.warnT > 0 && !frozen) {
          const wasCritical = st.warnT <= CRITICAL_TIME;
          st.warnT -= dt;
          unstable += 1;
          if (st.warnT <= CRITICAL_TIME) {
            anyCritical = true;
            if (!wasCritical) playWarn(true, Math.max(-1, Math.min(1, POWER_POINTS[i][0] / 6))); // just hit critical
          }
          if (st.warnT <= 0) {
            // TRIP — the breaker you failed to save cuts back to dark. Every trip
            // STINGS: the street darkens in a jolt and the grid-strain meter spikes,
            // so letting breakers go shoves you toward a total collapse (your core
            // job finally has teeth). The jolt is skipped during the finale (brownout
            // is disarmed there — the trips themselves are the finale's threat).
            const isVip = i === VIP_INDEX;
            st.on = false;
            st.warnT = 0;
            st.lost = true; // now a tripped breaker — it feeds the brownout meter
            st.flash = 1;
            restored.current -= 1;
            worldControls.shake = isVip ? 0.42 : 0.26;
            worldControls.lit *= isVip ? 0.5 : 0.7; // instant darken pulse
            if (!megaOn.current) brownout.current = Math.min(1, brownout.current + BROWNOUT_TRIP_JOLT);
            playMiss(Math.max(-1, Math.min(1, POWER_POINTS[i][0] / 6)));
            useFx.getState().shock();
            // VIP (hospital) going dark is a disaster — it costs a LIFE outright (not
            // during the finale, which has its own rules), with a loud dedicated alarm.
            if (isVip && !megaOn.current) {
              store.loseLife();
              worldControls.react = "shock";
              worldControls.zap = true;
              useShout.getState().shout("🏥 HOSPITAL DOWN! −1 life", "big");
            } else {
              useShout.getState().shout(pick(LINES.cut), "bad");
            }
            // Camped right on it when it trips → the current catches you (a life).
            const bx = p.x - POWER_POINTS[i][0];
            const bz = p.z - POWER_POINTS[i][1];
            if (!isVip && bx * bx + bz * bz < 2.4 * 2.4 && worldControls.invuln <= 0) {
              worldControls.react = "shock";
              worldControls.zap = true;
              store.loseLife();
            }
          }
        } else if (canDestabilise) {
          st.decayCd -= dt;
          if (st.decayCd <= 0) {
            // In the finale, cap how many can be dying at once so it stays winnable —
            // if we're at the cap, hold this one back and retry it shortly.
            if (megaOn.current && warnActive >= MEGA_MAX_WARN) {
              st.decayCd = 0.4 + Math.random() * 0.6;
            } else {
              st.warnT = WARN_TIME; // start a warning on this breaker
              warnActive += 1;
              unstable += 1;
              playWarn(false, Math.max(-1, Math.min(1, POWER_POINTS[i][0] / 6)));
              useShout.getState().shout(pick(LINES.surge), "bad");
            }
          }
        }
      } else if (st.lost && !frozen) {
        unstable += 1; // a TRIPPED breaker keeps the grid under pressure (but a
        // never-lit breaker you simply haven't reached yet does NOT — only trips do)
      }
    }

    // Critical breakers brown the whole street out — a visible, audible "it's going".
    if (anyCritical) worldControls.lit *= 0.8 + Math.random() * 0.12;

    // ── BROWNOUT meter: fills with instability, drains when whole; full = blackout.
    // Disarmed during the MEGA-SURGE finale — there the trips themselves are the
    // threat, and a blackout on top would double-punish and clear the onslaught.
    if (!megaOn.current && frac >= DECAY_START_FRAC && unstable > 0) {
      // Intensity already fills this faster INDIRECTLY (faster decay → more breakers
      // warning at once), so it is NOT multiplied here too — sim-verified that the
      // extra multiplier compounds into unfair instant blackouts during a late raid.
      brownout.current = Math.min(1, brownout.current + BROWNOUT_PER_UNIT * unstable * dt);
    } else {
      brownout.current = Math.max(0, brownout.current - BROWNOUT_DRAIN * dt);
    }
    if (brownout.current >= 1) {
      // TOTAL BLACKOUT — lose a life, clear every warning, then a recovery LULL so
      // the pressure resets into a breather (the "surge then lull" wave).
      store.loseLife();
      brownout.current = 0;
      lull.current = BROWNOUT_LULL;
      for (let i = 0; i < total; i++) {
        pointState[i].warnT = 0;
        if (pointState[i].on) pointState[i].decayCd = BROWNOUT_LULL + nextDecayDelay(frac, inten);
      }
      worldControls.shake = 0.5;
      worldControls.react = "shock";
      useFx.getState().shock();
      useShout.getState().shout("⚫ TOTAL BLACKOUT!", "big");
    }

    // ── NEPA RAIDS: periodic set-piece spikes ───────────────────────────────
    // Once half the street is lit, a countdown runs; when it fires, a CLUSTER of
    // stable lit breakers trips into warning at once (a "raid"). Raids come sooner
    // and bigger the later it gets (inten). Suppressed during the finale / a lull /
    // a stabiliser freeze, and never targets the last breaker so a win stays clean.
    if (!megaOn.current && !frozen && lull.current <= 0 && frac >= RAID_MIN_FRAC && restored.current < total) {
      if (raidCd.current >= 999) raidCd.current = nextRaidDelay(inten); // arm on first eligibility
      raidCd.current -= dt;
      if (raidCd.current <= 0) {
        raidCd.current = nextRaidDelay(inten);
        // Candidates: lit, stable (not already warning), not the VIP's only lifeline
        // to the finish — just stable lit breakers. Destabilise up to raidSize of them.
        const cand: number[] = [];
        for (let i = 0; i < total; i++) if (pointState[i].on && pointState[i].warnT <= 0) cand.push(i);
        // shuffle
        for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
        const n = Math.min(raidSize(inten), cand.length);
        for (let k = 0; k < n; k++) pointState[cand[k]].warnT = WARN_TIME;
        if (n > 0) {
          raids.current += 1;
          worldControls.shake = 0.3;
          useShout.getState().shout(`🚨 NEPA RAID! ${n} don trip!`, "big");
        }
      }
    } else if (megaOn.current || frac < RAID_MIN_FRAC) {
      raidCd.current = 999; // re-arm fresh next time raids are eligible
    }

    // ── Don't camp in the road ─────────────────────────────────────────────
    // Lingering in the traffic lanes ramps a danger timer: a shout warns you,
    // then it costs a LIFE and resets. The timer is HELD (and reset) while you're
    // stunned or in your post-hit invincibility — a car knock-down leaves you
    // lying in the road, and this must NOT drain a second life before you've had
    // a chance to get up and stagger clear. Crossing normally (~1.5s in the lanes)
    // never reaches it — only standing still, once recovered, does.
    const inRoad = Math.abs(p.x) < 2.5;
    const recovering = worldControls.stun > 0 || worldControls.invuln > 0;
    if (inRoad && !recovering) {
      roadT.current += dt;
      if (roadT.current > 2.2 && !roadWarned.current) {
        roadWarned.current = true;
        useShout.getState().shout(pick(LINES.traffic), "bad");
      }
      if (roadT.current > 3.8) {
        store.loseLife();
        worldControls.react = "shock";
        worldControls.shake = 0.4;
        useFx.getState().shock();
        roadT.current = 0;
        roadWarned.current = false;
      }
    } else {
      // out of the road, or still recovering — reset so you get a fresh timer.
      roadT.current = 0;
      roadWarned.current = false;
    }

    // Flip chain decays if you dawdle too long between breakers.
    if (chain.current > 0 && elapsed.current - lastFlip.current > CHAIN_WINDOW) chain.current = 0;

    // Reactive music: the groove swells from near-silent to full as light returns.
    setBedLevel(restored.current / total);

    // ── MEGA-SURGE finale: lighting the LAST breaker triggers NEPA's final assault.
    // You no longer win on the spot — you must HOLD the whole street lit for
    // MEGASURGE_HOLD seconds while breakers trip fast and in bunches. The hold timer
    // only advances while every breaker is lit, so a trip pauses (not resets) it
    // until you sprint it back up. Survive and the night is yours (+MEGASURGE_BONUS).
    if (restored.current >= total && !megaOn.current) {
      megaOn.current = true;
      megaHeld.current = 0;
      lull.current = 0;
      brownout.current = 0;
      for (let i = 0; i < total; i++) {
        pointState[i].warnT = 0;
        pointState[i].decayCd = megaDecayDelay() * 0.5; // the first trips come quick
      }
      worldControls.shake = 0.55;
      worldControls.react = "shock";
      useFx.getState().shock();
      useShout.getState().shout("⚡ NEPA MEGA-SURGE! HOLD THE LIGHT!", "big");
    }
    let megaWon = false;
    if (megaOn.current) {
      if (restored.current >= total) megaHeld.current += dt; // only counts while fully lit
      if (megaHeld.current >= MEGASURGE_HOLD) megaWon = true;
    }

    push.current += dt;
    if (push.current >= 0.08) {
      push.current = 0;
      store.setLive({
        elapsed: elapsed.current,
        restored: restored.current,
        pStreak: pStreak.current,
        chain: chain.current,
        brownout: brownout.current,
        saves: saves.current,
        megaActive: megaOn.current,
        mega: megaOn.current ? Math.min(1, megaHeld.current / MEGASURGE_HOLD) : 0,
        intensity: inten,
        vipLit: pointState[VIP_INDEX].on,
        vipWarn: pointState[VIP_INDEX].on && pointState[VIP_INDEX].warnT > 0,
        raidKey: raids.current,
        nearIdx,
        nearWarn,
      });
    }

    // WIN: survived the finale with the whole street held lit. Clock keeps counting
    // (faster = higher), and surviving the onslaught folds in a MEGASURGE_BONUS on
    // top of the perfect / dodge / chain bonuses and the flat ALL-PERFECT bonus.
    if (megaWon) {
      const bonus =
        perfectBonus.current + saveBonus.current + store.dodgeBonus + chainBonus.current +
        MEGASURGE_BONUS + (perfects.current >= total ? 150 : 0);
      playNepaUp();
      playCheer();
      setBedLevel(1);
      worldControls.shake = 0.4;
      useFx.getState().flash(true); // UP NEPA — the whole street floods with light
      useShout.getState().shout(pick(LINES.win), "big");
      store.finish({
        restored: total,
        total,
        timeTaken: elapsed.current,
        won: true,
        score: restoreScore(total, total, elapsed.current, bonus),
        parts: restoreParts(total, total, elapsed.current, bonus),
      });
    }
  });

  return null;
}
