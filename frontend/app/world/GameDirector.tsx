"use client";

// ─── Charge Rush director — "three sockets" ──────────────────────────────────
// Light just came. You have ONE extension box with three sockets and a yard full
// of things that need charging. This runs the whole loop:
//
//   • walk up to a device (empty-handed) → you pick it up. Heavy ones slow you.
//   • carry it to the box → it plugs into a free socket by itself.
//   • all plugged devices charge at once, but ONLY while the light is on.
//   • a full device is safe; step back to the box and you collect its money.
//   • NEPA gives a flicker warning, then cuts. Anything still charging is CAUGHT:
//     it pops out unpaid and goes back to its spot. Full ones stay safe.
//   • the blackout is your setup time: fetch the next device in the dark so it is
//     already plugged in when the light returns.
//   • the last light pays double.
//
// No button is needed to play: movement is the only verb, so the game is the
// DECISION (which device, is there time?). The action button just drops what you
// carry. The NEPA cycle itself (on → warn → cut → relight) is NepaDirector's.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { worldControls } from "./controls";
import {
  DEVICES, WEIGHT, STATION, SOCKET_COUNT, PICK_RADIUS, STATION_RADIUS, RESPAWN_DELAY, FINAL_MULT, TOTAL_WINDOWS,
  live, hands, freeSocket, resetLive, useGameStore, streakMult, scaledValue, type SocketView,
} from "./game";
import { useShout, pick, LINES } from "./shout";
import { useFx } from "./fx";
import { playHit, playBank, playMiss, playChargeTick, playStreetCheer, haptic } from "./audio";

const CAUGHT = ["NEPA catch your", "Light go! You lose the", "Chai! NEPA carry your"];

export default function GameDirector() {
  const score = useRef(0);
  const banked = useRef(0);
  const combo = useRef(0);
  const bestCombo = useRef(0);
  const best = useRef<{ label: string; value: number } | null>(null);
  const prevPhase = useRef("on");
  const wasPlaying = useRef(false);
  const heldPrev = useRef(false);
  const hudT = useRef(0);
  const tickT = useRef(0);
  const saidFinal = useRef(false);
  const tipped = useRef(0); // first-run nudges already shown

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const store = useGameStore.getState();
    const playing = store.mode === "playing";
    const wc = worldControls;

    if (playing && !wasPlaying.current) {
      score.current = 0;
      banked.current = 0;
      combo.current = 0;
      bestCombo.current = 0;
      best.current = null;
      prevPhase.current = "on";
      saidFinal.current = false;
      tipped.current = 0;
      resetLive();
    }
    wasPlaying.current = playing;
    for (const d of live) d.pulse = Math.max(0, d.pulse - dt * 2.2);
    if (!playing) {
      wc.speedMul = 1;
      wc.guide.active = false;
      heldPrev.current = false;
      return;
    }

    const p = wc.playerPos;
    const lightOn = wc.phase === "on" || wc.phase === "warn";
    const finalLight = wc.windowIndex >= TOTAL_WINDOWS - 1;
    const atBox = Math.hypot(p.x - STATION[0], p.z - STATION[1]) < STATION_RADIUS;

    // ── A car clipped you: whatever you were carrying goes back to its spot. ──
    if (wc.trafficHit) {
      wc.trafficHit = false;
      if (hands.idx >= 0) {
        const d = live[hands.idx];
        d.where = "home";
        d.pulse = 1;
        store.pushCaught(0, `🚐 You drop the ${DEVICES[hands.idx].label}!`);
        hands.idx = -1;
      }
      combo.current = 0;
    }
    if (wc.trafficDodge) {
      wc.trafficDodge = false;
      score.current += 3000;
      useShout.getState().shout("😮‍💨 Dodge! +₦3k", "good");
    }
    if (wc.pickup) {
      wc.pickup = null; // street pickups are simply cash in this mode
      score.current += 10000;
      useShout.getState().shout("💵 +₦10,000!", "good");
    }

    // ── Action button = put down what you carry (a mis-grab is never a trap). ──
    const press = wc.actionTap || (wc.actionHeld && !heldPrev.current);
    heldPrev.current = wc.actionHeld;
    wc.actionTap = false;
    wc.actionUp = false;
    if (press && hands.idx >= 0 && !atBox) {
      live[hands.idx].where = "home";
      live[hands.idx].pulse = 0.6;
      hands.idx = -1;
    }

    // ── Pick up: walk up to a device with empty hands. ───────────────────────
    if (hands.idx < 0) {
      let near = -1;
      let nd = PICK_RADIUS;
      for (let i = 0; i < DEVICES.length; i++) {
        const d = live[i];
        if (d.where !== "home" || d.respawn > 0) continue;
        const dist = Math.hypot(p.x - DEVICES[i].pos[0], p.z - DEVICES[i].pos[1]);
        if (dist < nd) {
          nd = dist;
          near = i;
        }
      }
      if (near >= 0) {
        hands.idx = near;
        live[near].where = "carried";
        live[near].pulse = 1;
        haptic(15);
        playHit(false, 0, 0);
        if (tipped.current === 0) {
          tipped.current = 1;
          useShout.getState().shout("Carry am go the sockets! 🔌", "good");
        }
      }
    }

    // ── At the box: plug what you carry, collect what is full. ───────────────
    if (atBox) {
      if (hands.idx >= 0) {
        const s = freeSocket();
        if (s >= 0) {
          const d = live[hands.idx];
          d.where = "socket";
          d.socket = s;
          d.progress = 0;
          d.ready = false;
          d.pulse = 1;
          hands.idx = -1;
          haptic(20);
          playHit(false, combo.current, 0.4);
          if (tipped.current === 1) {
            tipped.current = 2;
            useShout.getState().shout(lightOn ? "E dey charge! Go bring another ⚡" : "Plugged! E go charge when light come", "good");
          }
        } else if (tipped.current < 3) {
          tipped.current = 3;
          useShout.getState().shout("Sockets full! Wait make one finish", "bad");
        }
      }
      for (let i = 0; i < DEVICES.length; i++) {
        const d = live[i];
        if (d.where !== "socket" || !d.ready) continue;
        combo.current += 1;
        bestCombo.current = Math.max(bestCombo.current, combo.current);
        const mult = streakMult(combo.current) * (finalLight ? FINAL_MULT : 1);
        const value = Math.round((scaledValue(DEVICES[i].value, wc.windowIndex) * mult) / 100) * 100;
        score.current += value;
        banked.current += 1;
        if (!best.current || value > best.current.value) best.current = { label: DEVICES[i].label, value };
        store.pushBank(DEVICES[i].icon, value, mult, combo.current, false);
        playBank(value >= 40000, 0.4);
        playStreetCheer(Math.min(1, value / 60000), 0.3);
        useFx.getState().flash(value >= 40000);
        wc.shake = value >= 40000 ? 0.3 : 0.14;
        if (combo.current === 3 || combo.current === 6 || combo.current === 9) useShout.getState().shout(pick(LINES.combo), "big");
        d.where = "home";
        d.socket = -1;
        d.progress = 0;
        d.ready = false;
        d.respawn = RESPAWN_DELAY;
        d.pulse = 1;
      }
    }

    // ── Charging: only while the light is on. ────────────────────────────────
    let charging = 0;
    for (let i = 0; i < DEVICES.length; i++) {
      const d = live[i];
      if (d.respawn > 0) d.respawn = Math.max(0, d.respawn - dt);
      if (d.where !== "socket" || d.ready) continue;
      if (lightOn) {
        charging += 1;
        d.progress = Math.min(1, d.progress + dt / DEVICES[i].chargeTime);
        if (d.progress >= 1) {
          d.ready = true;
          d.pulse = 1;
          haptic(25);
          playHit(true, combo.current, 0.4);
          useShout.getState().shout(`${DEVICES[i].icon} ${DEVICES[i].label} don full! Collect am`, "good");
        }
      }
    }
    if (charging > 0) {
      tickT.current -= dt;
      if (tickT.current <= 0) {
        tickT.current = 0.42;
        const lead = Math.max(...live.map((d) => (d.where === "socket" && !d.ready ? d.progress : 0)));
        playChargeTick(lead, wc.phase === "warn", 0.4);
      }
    }

    // ── NEPA takes the light: every device still charging is caught. ─────────
    const phase = wc.phase;
    let roundOver = false;
    if (phase === "cut" && prevPhase.current !== "cut") {
      const caught: number[] = [];
      for (let i = 0; i < DEVICES.length; i++) {
        const d = live[i];
        if (d.where === "socket" && !d.ready) {
          caught.push(i);
          d.where = "home";
          d.socket = -1;
          d.progress = 0;
          d.pulse = 1;
        }
      }
      if (caught.length) {
        combo.current = 0;
        playMiss(0.4);
        const big = caught.reduce((a, b) => (DEVICES[b].value > DEVICES[a].value ? b : a), caught[0]);
        store.pushCaught(0, `${pick(CAUGHT)} ${DEVICES[big].label}!`);
      }
      if (wc.windowIndex >= TOTAL_WINDOWS - 1) roundOver = true;
    }
    if (phase === "on" && prevPhase.current !== "on" && finalLight && !saidFinal.current) {
      saidFinal.current = true;
      useShout.getState().shout(`⚡ LAST LIGHT! Everything pays ×${FINAL_MULT}`, "big");
    }
    prevPhase.current = phase;

    // ── Carry weight + where the guide arrow points. ─────────────────────────
    wc.speedMul = hands.idx >= 0 ? WEIGHT[DEVICES[hands.idx].id] ?? 1 : 1;
    const anyReady = live.some((d) => d.where === "socket" && d.ready);
    if (hands.idx >= 0 || anyReady) {
      wc.guide.x = STATION[0];
      wc.guide.z = STATION[1];
      wc.guide.active = !atBox;
    } else {
      // empty hands, nothing to collect: point at the best thing you could still
      // fetch AND fill before the cut (a nudge, not an order).
      let bi = -1;
      let bv = -1;
      const room = freeSocket() >= 0;
      for (let i = 0; i < DEVICES.length; i++) {
        const d = live[i];
        if (!room || d.where !== "home" || d.respawn > 0) continue;
        const walk = (Math.hypot(p.x - DEVICES[i].pos[0], p.z - DEVICES[i].pos[1]) + Math.hypot(DEVICES[i].pos[0] - STATION[0], DEVICES[i].pos[1] - STATION[1])) / 3.2;
        const fits = !lightOn || walk + DEVICES[i].chargeTime < wc.lightLeft;
        const v = DEVICES[i].value / (walk + DEVICES[i].chargeTime) * (fits ? 1 : 0.15);
        if (v > bv) {
          bv = v;
          bi = i;
        }
      }
      wc.guide.active = bi >= 0;
      if (bi >= 0) {
        wc.guide.x = DEVICES[bi].pos[0];
        wc.guide.z = DEVICES[bi].pos[1];
      }
    }

    // ── HUD push (a few times a second). ─────────────────────────────────────
    hudT.current -= dt;
    if (hudT.current <= 0 || roundOver) {
      hudT.current = 0.1;
      const sockets: SocketView[] = [];
      for (let s = 0; s < SOCKET_COUNT; s++) {
        const i = live.findIndex((d) => d.where === "socket" && d.socket === s);
        sockets.push(i < 0 ? { idx: -1, pct: 0, ready: false } : { idx: i, pct: Math.round(live[i].progress * 100), ready: live[i].ready });
      }
      store.setLive({
        score: Math.round(score.current),
        banked: banked.current,
        combo: combo.current,
        multiplier: streakMult(combo.current),
        windowIndex: wc.windowIndex,
        lightLeft: wc.lightLeft,
        lightOn,
        sockets,
        carrying: hands.idx,
        finalLight,
        near: null,
        hotIdx: null,
      });
    }

    if (roundOver) {
      // anything that finished charging before the last cut is yours
      for (let i = 0; i < DEVICES.length; i++) {
        const d = live[i];
        if (d.where === "socket" && d.ready) {
          const value = scaledValue(DEVICES[i].value, wc.windowIndex) * FINAL_MULT;
          score.current += value;
          banked.current += 1;
          if (!best.current || value > best.current.value) best.current = { label: DEVICES[i].label, value };
        }
      }
      wc.speedMul = 1;
      wc.guide.active = false;
      store.endGame({ score: Math.round(score.current), banked: banked.current, bestCombo: bestCombo.current, best: best.current });
    }
  });

  return null;
}
