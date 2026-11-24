"use client";

// ─── /world — walkable 3D UP NEPA neighbourhood (client-only) ────────────────
// This module is the whole 3D app. It is lazy-loaded by ./page.tsx with
// { ssr: false } so three/r3f never server-render and never touch other routes'
// bundles. Holds the <Canvas>, the 2D HUD, the keyboard + visibility handling,
// and the manual NEPA trigger. All 3D content is in ./Scene.tsx and children.
//
// M1 BLOCKOUT: stylised low-poly, warm golden-hour, not final Lagos art. The
// reactive NEPA light cycle (power on → NEPA cut → UP NEPA relight) is the point.

import { toast } from "@/lib/toast";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import Scene from "./Scene";
import { useRankedRun } from "@/hooks/useRankedRun";
import Joystick from "./Joystick";
import { worldControls, resetWorldControls } from "./controls";
import { useWorldStore } from "./store";
import { quality } from "./quality";
import { setWorldAudioEnabled, armWorldAudio, setWorldAudioMuted } from "./audio";
import { useGameStore, DEVICES, naira, TOTAL_WINDOWS, FINAL_MULT, streakMult } from "./game";
import { useAppStore } from "./appStore";
import { useRestoreStore, SCORE_MAX } from "./restore";
import { recordHigh, type High } from "./highscore";
import { useFx } from "./fx";
import { useShout } from "./shout";
import ModeSelect from "./ModeSelect";
import { useFriendRoom } from "@/hooks/useFriendRoom";
import FriendsPlay from "@/components/FriendsPlay";

// ── Shared HUD / overlay styles ──────────────────────────────────────────────
// Every live readout (score, timer, lives, combo) is one of these: a glass chip
// in the display font whose border and glow take the readout's own colour, so
// the row reads at a glance on a phone in sunlight.
const pill = (color: string): CSSProperties => ({
  color,
  fontFamily: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  fontWeight: 700,
  fontSize: 15,
  lineHeight: 1,
  whiteSpace: "nowrap", // a chip never squashes; the row wraps to a second line instead
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.01em",
  background: "linear-gradient(180deg, rgba(42,18,64,0.82), rgba(10,1,32,0.86))",
  border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
  borderRadius: 999,
  padding: "8px 14px",
  backdropFilter: "blur(10px) saturate(1.3)",
  WebkitBackdropFilter: "blur(10px) saturate(1.3)",
  boxShadow: `0 6px 18px -8px rgba(0,0,0,0.8), 0 0 14px -6px ${color}, inset 0 1px rgba(255,255,255,0.14)`,
  textShadow: "0 1px 0 rgba(0,0,0,0.35)",
});

// Start / result sheets share the lobby's look: a glass panel docked to the
// bottom over a light scrim, so the street stays in view behind it.
const HUD_DISPLAY = '"Melon Pop", "Fredoka", system-ui, sans-serif';
const HUD_BODY = '"Fredoka", system-ui, sans-serif';
const overlay: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)",
  background: "linear-gradient(180deg, rgba(10,1,32,0) 0%, rgba(10,1,32,0.15) 40%, rgba(10,1,32,0.76) 100%)",
  fontFamily: HUD_BODY,
};

const card: CSSProperties = {
  pointerEvents: "auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  maxWidth: 460,
  width: "100%",
  padding: "18px 16px 14px",
  borderRadius: 26,
  background: "linear-gradient(180deg, rgba(42,18,64,0.8), rgba(10,1,32,0.92))",
  border: "1px solid rgba(255,255,255,0.14)",
  backdropFilter: "blur(14px) saturate(1.3)",
  WebkitBackdropFilter: "blur(14px) saturate(1.3)",
  boxShadow: "0 24px 60px -20px rgba(0,0,0,0.8), inset 0 1px rgba(255,255,255,0.12)",
  fontFamily: HUD_BODY,
};

// Three-step "how to play" rows used on the start sheets.
const stepRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 12px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#f4f1ea",
  fontSize: 13.5,
  fontWeight: 500,
  textAlign: "left",
};
const Steps = ({ items }: { items: [string, string][] }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", margin: "10px 0 14px" }}>
    {items.map(([icon, text]) => (
      <div key={text} style={stepRow}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
        <span>{text}</span>
      </div>
    ))}
  </div>
);

// Speedrun grade from finish time (PAR is 45s). Drives the "aim higher" pull.
const GRADES: { label: string; under: number; color: string }[] = [
  { label: "S", under: 30, color: "#ffd700" },
  { label: "A", under: 45, color: "#8ff0a4" },
  { label: "B", under: 70, color: "#7fb8ff" },
];
function gradeFor(t: number): { label: string; color: string } {
  return GRADES.find((g) => t < g.under) ?? { label: "C", color: "#cfc7e8" };
}
// "How close was I?" — the gap to the next grade up, the single most useful line
// on a result screen for making someone press Play again.
function nextGrade(t: number): { label: string; gap: number; color: string } | null {
  const i = GRADES.findIndex((g) => t < g.under);
  const next = i === -1 ? GRADES[GRADES.length - 1] : i > 0 ? GRADES[i - 1] : null;
  return next ? { label: next.label, gap: t - next.under, color: next.color } : null;
}

const primaryBtn: CSSProperties = {
  pointerEvents: "auto",
  alignSelf: "stretch",
  padding: "14px 28px",
  borderRadius: 16,
  border: "none",
  background: "linear-gradient(180deg, #4ade80, #22c55e)",
  color: "#06230f",
  fontFamily: HUD_DISPLAY,
  fontWeight: 700,
  fontSize: 19,
  cursor: "pointer",
  boxShadow: "0 4px 0 #15803d, 0 12px 24px -8px rgba(34,197,94,0.6)",
};

export default function World() {
  // Decided before the first render (this page never renders on the server), so
  // the renderer is created with the right settings for the device.
  const [q] = useState(() => quality());
  const isMobile = q.mobile;
  const [running, setRunning] = useState(true);
  const [muted, setMuted] = useState(false);
  // Free-roam is the default: you spawn in the city and roam. The mode picker
  // is an on-demand launcher, not a screen that blocks the view.
  const [modesOpen, setModesOpen] = useState(true); // land on the lobby; only Free Roam closes it
  // Personal-best time for Restore (localStorage), computed when a run is won.
  const [bestInfo, setBestInfo] = useState<{ isBest: boolean; prevBest: number | null }>({ isBest: false, prevBest: null });
  const hud = useWorldStore((s) => s.hud);
  const driving = useWorldStore((s) => s.driving);
  const keys = useRef<Record<string, boolean>>({});

  // Charging-game state.
  const mode = useGameStore((s) => s.mode);
  const gScore = useGameStore((s) => s.score);
  const windowIndex = useGameStore((s) => s.windowIndex);
  const combo = useGameStore((s) => s.combo);
  const multiplier = useGameStore((s) => s.multiplier);
  const gSockets = useGameStore((s) => s.sockets);
  const gCarrying = useGameStore((s) => s.carrying);
  const lightLeft = useGameStore((s) => s.lightLeft);
  const lightOn = useGameStore((s) => s.lightOn);
  const pop = useGameStore((s) => s.pop);
  const summary = useGameStore((s) => s.summary);
  const startGame = useGameStore((s) => s.startGame);
  const backToIdle = useGameStore((s) => s.backToIdle);

  // Top-level mode routing + Restore-the-Light state.
  const appMode = useAppStore((s) => s.mode);
  const setAppMode = useAppStore((s) => s.setMode);
  const fxKey = useFx((s) => s.key);
  const fxBig = useFx((s) => s.big);
  const fxKind = useFx((s) => s.kind);
  const shoutKey = useShout((s) => s.key);
  const shoutText = useShout((s) => s.text);
  const shoutTone = useShout((s) => s.tone);
  const rState = useRestoreStore((s) => s.mode);
  const rElapsed = useRestoreStore((s) => s.elapsed);
  const rRestored = useRestoreStore((s) => s.restored);
  const rTotal = useRestoreStore((s) => s.total);
  const rLives = useRestoreStore((s) => s.lives);
  const rPStreak = useRestoreStore((s) => s.pStreak);
  const rDodgeStreak = useRestoreStore((s) => s.dodgeStreak);
  const rChain = useRestoreStore((s) => s.chain);
  const rBrownout = useRestoreStore((s) => s.brownout);
  const rSaves = useRestoreStore((s) => s.saves);
  const rMegaActive = useRestoreStore((s) => s.megaActive);
  const rMega = useRestoreStore((s) => s.mega);
  const rVipWarn = useRestoreStore((s) => s.vipWarn);
  const rIntensity = useRestoreStore((s) => s.intensity);
  const rNearIdx = useRestoreStore((s) => s.nearIdx);
  const rNearWarn = useRestoreStore((s) => s.nearWarn);
  const rSummary = useRestoreStore((s) => s.summary);
  const rStart = useRestoreStore((s) => s.start);
  const rReset = useRestoreStore((s) => s.reset);

  // High score for each mode: worked out once when a run ends, win or lose.
  const [rHigh, setRHigh] = useState<High | null>(null);
  const [cHigh, setCHigh] = useState<High | null>(null);
  const rScored = useRef<unknown>(null);
  const cScored = useRef<unknown>(null);
  useEffect(() => {
    if (!rSummary) { rScored.current = null; setRHigh(null); return; }
    if (rScored.current === rSummary) return; // this run is already counted
    rScored.current = rSummary;
    setRHigh(recordHigh("restore", rSummary.score));
  }, [rSummary]);
  useEffect(() => {
    if (!summary) { cScored.current = null; setCHigh(null); return; }
    if (cScored.current === summary) return;
    cScored.current = summary;
    setCHigh(recordHigh("charge", summary.score));
  }, [summary]);

  // On a won run, compare the finish time to the stored personal best (and store
  // the new one). Drives the "NEW BEST!" flash + the delta on the win screen.
  useEffect(() => {
    if (rState !== "won" || !rSummary?.won || rSummary.timeTaken == null) return;
    const t = rSummary.timeTaken;
    let prev: number | null = null;
    try {
      const raw = localStorage.getItem("upnepa_restore_best");
      if (raw != null) prev = parseFloat(raw);
    } catch {
      /* ignore */
    }
    const isBest = prev == null || t < prev;
    if (isBest) {
      try {
        localStorage.setItem("upnepa_restore_best", String(t));
      } catch {
        /* ignore */
      }
    }
    setBestInfo({ isBest, prevBest: prev });
  }, [rState, rSummary]);

  const beginRound = () => {
    armWorldAudio();
    startGame();
  };
  // Ranked Restore rounds (signed-in players). The server ticket is opened
  // BEFORE the clock starts, because the server times the run from the ticket.
  const ranked = useRankedRun("nepa3d");
  const rankedRef = useRef(ranked);
  rankedRef.current = ranked;
  const [rankedRound, setRankedRound] = useState(false);
  const opening = useRef(false);
  // A friend room is a race: everyone starts Restore the Light at the same
  // moment and the room ranks the results. A room round is never ranked.
  const room = useFriendRoom("nepa3d");
  const roomRef = useRef(room);
  roomRef.current = room;
  const roomRound = useRef(0);
  const roomRun = useRef(false);
  const beginRestore = () => {
    armWorldAudio();
    if (opening.current) return;
    setRankedRound(false);
    if (roomRun.current) { rStart(); return; }
    if (!rankedRef.current.canRank) { rStart(); return; }
    opening.current = true;
    // never hold the player up for long: if the server is slow, play unranked
    const giveUp = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    void Promise.race([rankedRef.current.start().catch(() => null), giveUp]).then((o) => {
      opening.current = false;
      const ok = !!o && o.success && rankedRef.current.hasTicket();
      setRankedRound(ok);
      if (!ok) toast("This round is not ranked: the game server could not open it. You can still play.");
      rStart();
    });
  };
  // when a ranked round ends, send it to be checked and saved
  const rSent = useRef<unknown>(null);
  useEffect(() => {
    if (!rSummary || rSent.current === rSummary) return;
    rSent.current = rSummary;
    if (roomRun.current) { void roomRef.current.finish({ nepa3dRun: { won: rSummary.won, restored: rSummary.restored, timeTaken: rSummary.timeTaken, skill: rSummary.parts?.skill ?? 0 } }); return; }
    if (!rankedRef.current.hasTicket()) return;
    void rankedRef.current.finish({
      score: rSummary.score,
      gameTime: (rSummary.timeTaken ?? 5) * 1000,
      proof: { nepa3dRun: { won: rSummary.won, restored: rSummary.restored, timeTaken: rSummary.timeTaken, skill: rSummary.parts?.skill ?? 0 } },
    });
  }, [rSummary]);
  // The lobby's Start button goes straight into the round. The mode's scene has
  // to mount before its round can begin, so the start is held until the mode is
  // showing its ready state, then fired once (see the effect below).
  const [autoStart, setAutoStart] = useState<null | "restore" | "charge">(null);
  const pickFromLobby = (m: "restore" | "charge" | "roam") => {
    armWorldAudio();
    if (m === "roam") { setModesOpen(false); return; }
    if (m === "charge") backToIdle(); else rReset();
    setAutoStart(m);
    setAppMode(m);
  };
  useEffect(() => {
    if (!autoStart || appMode !== autoStart) return;
    const ready = autoStart === "restore" ? rState === "idle" : mode === "idle";
    if (!ready) return;
    const t = setTimeout(() => { if (autoStart === "restore") beginRestore(); else beginRound(); setAutoStart(null); }, 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, appMode, rState, mode]);

  // While the lobby is open nothing is playable: movement input is dropped and
  // the stick is hidden. Scene.tsx reads the same flag to turn the camera slowly.
  const lobbyOpen = appMode === "menu" && modesOpen && !driving;
  const lobbyRef = useRef(lobbyOpen);
  useEffect(() => {
    lobbyRef.current = lobbyOpen;
    useAppStore.getState().setLobby(lobbyOpen);
    if (lobbyOpen) { worldControls.input.x = 0; worldControls.input.z = 0; }
  }, [lobbyOpen]);

  // the host pressed start: everyone goes into Restore the Light now
  useEffect(() => {
    const v = room.view;
    if (!v || v.status !== "playing" || v.round === roomRound.current || v.players[v.you]?.done) return;
    roomRound.current = v.round;
    roomRun.current = true;
    pickFromLobby("restore");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.view]);
  // friends see how many breakers you have lit
  useEffect(() => { if (roomRun.current && rState === "playing") roomRef.current.progress(rRestored); }, [rRestored, rState]);
  // leaving the room, or a rematch being called, goes back to the lobby
  useEffect(() => {
    if (!roomRun.current) return;
    if (!room.inRoom || room.view?.status === "waiting") { roomRun.current = false; toMenu(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.inRoom, room.view?.status]);
  // dev only: lets an automated check end a round without playing the 3D street
  useEffect(() => { if (process.env.NODE_ENV !== "production") (window as unknown as { __restore?: unknown }).__restore = { store: useRestoreStore, inRoomRun: () => roomRun.current }; }, []);

  const toMenu = () => {
    setModesOpen(true); // back from a game → straight to the lobby
    backToIdle();
    rReset();
    resetWorldControls();
    setAppMode("menu");
  };
  const skipIntro = () => {
    worldControls.lit = 1;
    useWorldStore.getState().setHud(null);
    armWorldAudio();
    setAppMode("menu");
  };

  // Reset to the menu on mount / tear down audio on unmount.
  // This runs again whenever React hides and re-shows the world while part of
  // a mode's scene is still loading. It must only reset the game the first
  // time, or starting a mode throws the player back to the lobby.
  const didInit = useRef(false);
  useEffect(() => {
    setWorldAudioEnabled(true);
    if (didInit.current) return () => setWorldAudioEnabled(false);
    didInit.current = true;
    resetWorldControls();
    backToIdle();
    rReset();
    // Play the cinematic cold-open only the FIRST time; returning/replaying
    // visitors go straight to the menu (don't make a judge re-watch it).
    let seenIntro = false;
    try {
      seenIntro = localStorage.getItem("upnepa_seen_intro") === "1";
    } catch {
      /* ignore */
    }
    if (seenIntro) {
      worldControls.lit = 1;
      setAppMode("menu");
    } else {
      try {
        localStorage.setItem("upnepa_seen_intro", "1");
      } catch {
        /* ignore */
      }
      setAppMode("intro");
    }
    setWorldAudioEnabled(true);
    useWorldStore.getState().setLowPerf(q.tier !== "high");
    return () => setWorldAudioEnabled(false);
  }, [backToIdle, rReset, setAppMode]);

  // Keyboard: WASD / arrows → worldControls.input; N → toggle NEPA.
  useEffect(() => {
    const recompute = () => {
      const k = keys.current;
      let x = 0;
      let z = 0;
      if (k["w"] || k["arrowup"]) z -= 1;
      if (k["s"] || k["arrowdown"]) z += 1;
      if (k["a"] || k["arrowleft"]) x -= 1;
      if (k["d"] || k["arrowright"]) x += 1;
      if (lobbyRef.current) { x = 0; z = 0; } // the lobby is a gate
      worldControls.input.x = x;
      worldControls.input.z = z;
    };
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "n") {
        // Debug-only NEPA toggle — never in production (it would let you skip the
        // blackout penalty / drive the window on a scored leaderboard game).
        if (process.env.NODE_ENV !== "production") worldControls.pendingToggle = true;
        return;
      }
      if (key === " " || key === "spacebar") {
        if (!e.repeat) {
          worldControls.actionTap = true; // Restore: throw the switch (one tap)
          worldControls.actionHeld = true; // Charge: begin holding the charge
        }
        e.preventDefault();
        return;
      }
      if (key === "e") {
        worldControls.enterExit = true; // hop in / out of a nearby vehicle
        e.preventDefault();
        return;
      }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        keys.current[key] = true;
        recompute();
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === " " || key === "spacebar") {
        worldControls.actionHeld = false;
        worldControls.actionUp = true; // Charge: release → bank the charge
        return;
      }
      if (keys.current[key]) {
        keys.current[key] = false;
        recompute();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Pause rendering when the tab is hidden (perf + battery).
  useEffect(() => {
    const onVis = () => setRunning(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // A quick TAP (not a drag) throws the breaker switch in Restore mode. Drags
  // still orbit the camera; taps on HUD buttons fire their own handler too (and
  // a stray flip off a breaker is harmless — the director ignores it).
  useEffect(() => {
    let sx = 0;
    let sy = 0;
    let st = 0;
    let onCanvas = false;
    let holding = false; // a Charge press-hold is live on the canvas
    let cancelled = false; // the press turned into a camera-orbit drag
    const onDown = (e: PointerEvent) => {
      sx = e.clientX;
      sy = e.clientY;
      st = performance.now();
      holding = false;
      cancelled = false;
      // Only a press that STARTS on the 3D canvas counts — not the joystick, the
      // FLIP/PUMP/mute buttons or other HUD controls (a stray tap there used to
      // fire a mistimed action and kill the combo).
      onCanvas = (e.target as HTMLElement | null)?.tagName === "CANVAS";
      // Charge: a still press on the scene starts CHARGING the device you're on.
      // If the finger then drags past the threshold it becomes a camera orbit and
      // the charge is cancelled (no bank) — so holding and looking around coexist.
      if (onCanvas && useAppStore.getState().mode === "charge") {
        worldControls.actionHeld = true;
        holding = true;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!holding || cancelled) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 12) {
        worldControls.actionHeld = false; // became an orbit drag → cancel, no bank
        holding = false;
        cancelled = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!onCanvas) return;
      const moved = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (performance.now() - st < 300 && moved < 12) worldControls.actionTap = true; // Restore flip
      if (holding) {
        worldControls.actionHeld = false; // Charge: clean release → bank
        worldControls.actionUp = true;
      }
      holding = false;
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Unlock + start audio on the first user gesture (tap / key / canvas click).
  // Browsers block autoplay until then; after one gesture we tear the listeners
  // down. armWorldAudio() is a no-op if already armed.
  useEffect(() => {
    const arm = () => {
      armWorldAudio();
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
    };
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    window.addEventListener("touchstart", arm);
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      window.removeEventListener("touchstart", arm);
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#0a0120", touchAction: "none" }}>
      <Canvas
        shadows={!isMobile}
        frameloop="never"
        dpr={[1, q.dpr]}
        gl={{ antialias: !isMobile, powerPreference: "high-performance" }}
        camera={{ position: [0, 4.2, 8], fov: 55, near: 0.1, far: 140 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Scene isMobile={isMobile} running={running} />
      </Canvas>

      {/* ── HUD ───────────────────────────────────────────────────────── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
        {/* Top bar (hidden during the intro cold-open) */}
        <div
          style={{
            display: appMode === "intro" ? "none" : "flex",
            position: "absolute",
            top: "calc(12px + env(safe-area-inset-top))",
            left: 0,
            right: 0,
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
          }}
        >
          {appMode === "menu" ? (
            <Link
              href="/"
              style={{
                pointerEvents: "auto",
                color: "#fff",
                textDecoration: "none",
                background: "rgba(20,8,40,0.5)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 14,
                backdropFilter: "blur(4px)",
              }}
            >
              ← Arena
            </Link>
          ) : (
            <button
              onClick={toMenu}
              style={{
                pointerEvents: "auto",
                color: "#fff",
                background: "rgba(20,8,40,0.5)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 14,
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              ← Modes
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                setWorldAudioMuted(next);
              }}
              aria-label={muted ? "Unmute" : "Mute"}
              style={{
                pointerEvents: "auto",
                color: "#fff",
                fontSize: 15,
                lineHeight: 1,
                background: "rgba(20,8,40,0.5)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 999,
                padding: "8px 11px",
                cursor: "pointer",
                backdropFilter: "blur(4px)",
              }}
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>

        {/* NEPA banner */}
        {hud && hud.title && (
          <div
            key={hud.key}
            style={{
              position: "absolute",
              top: "22%",
              left: 0,
              right: 0,
              textAlign: "center",
              animation: "worldNepaPop 0.4s ease-out",
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "10px 22px",
                borderRadius: 16,
                fontWeight: 800,
                fontSize: "clamp(22px, 6vw, 44px)",
                color: hud.tone === "relight" ? "#2a1800" : "#fff",
                background:
                  hud.tone === "relight"
                    ? "linear-gradient(90deg,#ffd27a,#f4c020)"
                    : "rgba(10,16,40,0.7)",
                border: hud.tone === "relight" ? "none" : "1px solid rgba(120,150,255,0.5)",
                textShadow: hud.tone === "relight" ? "none" : "0 2px 12px rgba(0,0,0,0.6)",
                boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
              }}
            >
              {hud.title}
            </div>
            {hud.sub && (
              <div style={{ marginTop: 8, color: "#fff", opacity: 0.85, fontSize: 14, textShadow: "0 1px 6px #000" }}>
                {hud.sub}
              </div>
            )}
          </div>
        )}

        {/* Controls hint (only while playing) */}
        {appMode === "charge" && mode === "playing" && windowIndex === 0 && (
          <div
            style={{
              position: "absolute",
              // under the chips + light bar, centred; only for the first window so
              // it teaches once and then gets out of the way
              top: "calc(186px + env(safe-area-inset-top))",
              left: 0,
              right: 0,
              textAlign: "center",
              color: "#fff",
              opacity: 0.75,
              fontFamily: '"Fredoka", system-ui, sans-serif',
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 1.5,
              textShadow: "0 1px 4px #000",
            }}
          >
            {isMobile ? "Stick to move · drag to look" : "WASD to move · drag to look"}
            <br />
            Walk into a device to pick it up, then take it to the sockets
          </div>
        )}

        {/* Score + timer + combo + the LIGHT countdown (the race) */}
        {appMode === "charge" && mode === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "calc(50px + env(safe-area-inset-top))",
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={pill("#ffffff")}>💡 Light {Math.min(windowIndex + 1, TOTAL_WINDOWS)} of {TOTAL_WINDOWS}</div>
              <div style={pill("#ffd27a")}>💰 {naira(gScore)}</div>
              {combo >= 2 && (
                <div
                  key={combo}
                  style={{
                    ...pill(multiplier >= 3 ? "#ffd166" : "#ffb8f0"),
                    animation: "worldComboPulse 0.3s ease-out",
                    border: "1px solid rgba(255,180,255,0.5)",
                  }}
                >
                  🔥 {combo} · ×{multiplier}
                </div>
              )}
            </div>

            {/* The three sockets: the whole game at a glance. Each slot shows what
                is plugged in and how full it is; a full one turns green and tells
                you to come and collect. */}
            <div style={{ display: "flex", gap: 6 }}>
              {(gSockets.length ? gSockets : [{ idx: -1, pct: 0, ready: false }, { idx: -1, pct: 0, ready: false }, { idx: -1, pct: 0, ready: false }]).map((sk, i) => {
                const c = sk.idx < 0 ? "#8b84a8" : sk.ready ? "#4ade80" : "#ffd56b";
                return (
                  <div
                    key={i}
                    style={{ ...pill(c), position: "relative", overflow: "hidden", minWidth: 74, textAlign: "center", padding: "8px 10px", animation: sk.ready ? "worldComboPulse 0.6s ease-in-out infinite" : undefined }}
                  >
                    {sk.idx >= 0 && !sk.ready && (
                      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${sk.pct}%`, background: lightOn ? "rgba(255,213,107,0.28)" : "rgba(255,255,255,0.1)", transition: "width 0.12s linear" }} />
                    )}
                    <span style={{ position: "relative" }}>
                      {sk.idx < 0 ? "🔌 free" : sk.ready ? `${DEVICES[sk.idx].icon} ✓ collect` : `${DEVICES[sk.idx].icon} ${sk.pct}%`}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* POWER SURGE finale banner — the last window pays double everywhere. */}
            {windowIndex >= TOTAL_WINDOWS - 1 && lightOn && (
              <div
                style={{
                  padding: "6px 18px", borderRadius: 999, fontWeight: 900,
                  fontSize: "clamp(14px,4vw,20px)", color: "#3a1800",
                  background: "linear-gradient(90deg,#ffe14d,#ffb020)",
                  boxShadow: "0 0 22px rgba(255,200,60,0.7)",
                  animation: "worldComboPulse 0.5s ease-out infinite",
                }}
              >
                ⚡ LAST LIGHT — everything pays ×{FINAL_MULT}!
              </div>
            )}

            {/* LIGHT countdown bar — this is what you are racing. */}
            <div
              style={{
                width: "min(78vw, 360px)",
                background: "rgba(10,8,24,0.6)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 999,
                padding: "5px 12px 7px",
                backdropFilter: "blur(4px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  color: !lightOn ? "#7aa0ff" : lightLeft <= 3 ? "#ff6b6b" : "#ffd27a",
                  marginBottom: 3,
                }}
              >
                <span>{!lightOn ? "🌑 BLACKOUT" : lightLeft <= 3 ? "⚠ NEPA COMING!" : "⚡ LIGHT"}</span>
                <span>{lightOn ? `${Math.ceil(lightLeft)}s` : ""}</span>
              </div>
              <span
                style={{
                  display: "block",
                  height: 7,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.13)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${Math.round(Math.min(1, lightLeft / 17) * 100)}%`,
                    background: !lightOn
                      ? "#4a6cff"
                      : lightLeft <= 3
                        ? "#ff5a5a"
                        : "linear-gradient(90deg,#ffd27a,#f4c020)",
                    transition: "width 0.12s linear",
                  }}
                />
              </span>
            </div>
          </div>
        )}

        {/* Bank / caught popup */}
        {appMode === "charge" && pop && (
          <div
            key={pop.id}
            style={{
              position: "absolute",
              top: "38%",
              left: 0,
              right: 0,
              textAlign: "center",
              pointerEvents: "none",
              animation: "worldBankPop 1s ease-out forwards",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "6px 18px",
                borderRadius: 999,
                fontWeight: 800,
                fontSize: "clamp(18px, 5.5vw, 32px)",
                color: pop.kind === "caught" ? "#fff" : "#16331a",
                background:
                  pop.kind === "caught"
                    ? "linear-gradient(90deg,#ff6b6b,#c81d1d)"
                    : "linear-gradient(90deg,#8ff0a4,#36d46a)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
              }}
            >
              {pop.kind === "caught"
                ? `💥 ${pop.label ?? `NEPA caught you! ${pop.combo} combo gone`}`
                : `${pop.perfect ? "⭐ PERFECT  " : ""}${pop.icon} +${naira(pop.value)}${pop.mult > 1 ? ` ×${pop.mult}` : ""}`}
            </span>
          </div>
        )}

        {/* One coaching line: always says the single next thing to do. */}
        {appMode === "charge" && mode === "playing" && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(128px + env(safe-area-inset-bottom))",
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            <div style={{ ...pill(gCarrying >= 0 ? "#ffd56b" : gSockets.some((x) => x.ready) ? "#4ade80" : "#f4f1ea"), fontSize: 14, whiteSpace: "normal", textAlign: "center", maxWidth: "88vw" }}>
              {gCarrying >= 0
                ? gSockets.length && gSockets.every((x) => x.idx >= 0)
                  ? "Sockets full. Collect one first"
                  : `${DEVICES[gCarrying].icon} Carry the ${DEVICES[gCarrying].label} to the sockets`
                : gSockets.some((x) => x.ready)
                  ? "✓ One don full! Go collect your money"
                  : gSockets.some((x) => x.idx < 0)
                    ? lightOn
                      ? "Walk to a device to pick it up"
                      : "No light. Fetch the next one now, ready for when e come"
                    : lightOn
                      ? "All three dey charge. Stay near to collect"
                      : "No light. Wait make NEPA bring am"}
            </div>
            {gCarrying >= 0 && (
              <button
                onPointerDown={(e) => {
                  e.stopPropagation();
                  worldControls.actionTap = true;
                }}
                style={{
                  pointerEvents: "auto",
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 999,
                  padding: "8px 18px",
                  background: "rgba(10,1,32,0.7)",
                  color: "#f4f1ea",
                  fontFamily: HUD_BODY,
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Put it down
              </button>
            )}
          </div>
        )}

        {/* ── Restore the Light in-game HUD ──────────────────────────────── */}
        {appMode === "restore" && rState === "playing" && (
          <div
            style={{
              position: "absolute",
              top: "calc(50px + env(safe-area-inset-top))",
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
              <div style={pill("#ffffff")}>⏱ {rElapsed.toFixed(1)}s</div>
              {/* The street as a row of bulbs: a finish line you can SEE filling up.
                  People push harder the closer a visible goal gets, so the last
                  unlit bulbs pulse to pull you to the end. */}
              <div style={{ ...pill("#ffd27a"), display: "flex", alignItems: "center", gap: 3, padding: "8px 10px" }} aria-label={`${rRestored} of ${rTotal} lit`}>
                {Array.from({ length: rTotal }, (_, i) => {
                  const on = i < rRestored;
                  const closing = !on && rTotal - rRestored <= 3;
                  return (
                    <span
                      key={i}
                      style={{
                        width: 7,
                        height: 11,
                        borderRadius: "50% 50% 45% 45%",
                        background: on ? "#ffd56b" : "rgba(255,255,255,0.16)",
                        boxShadow: on ? "0 0 8px 1px rgba(255,213,107,0.9)" : "none",
                        transition: "background 0.25s, box-shadow 0.25s, transform 0.25s",
                        transform: on ? "scale(1.12)" : "scale(1)",
                        animation: closing ? "worldComboPulse 0.7s ease-in-out infinite" : undefined,
                      }}
                    />
                  );
                })}
              </div>
              <div key={`rlives${rLives}`} style={{ ...pill(rLives <= 1 ? "#ff7a7a" : "#ff9db0"), animation: rLives <= 1 ? "worldComboPulse 0.5s ease-out infinite" : undefined }}>
                {"❤️".repeat(rLives) || "💀"}
              </div>
              {rPStreak >= 2 && (
                <div key={`rps${rPStreak}`} style={{ ...pill("#ffe14d"), animation: "worldComboPulse 0.3s ease-out", border: "1px solid rgba(255,225,80,0.6)" }}>
                  ⭐ PERFECT ×{rPStreak}
                </div>
              )}
              {rDodgeStreak >= 1 && (
                <div key={`dodge${rDodgeStreak}`} style={{ ...pill("#7ad0ff"), animation: "worldComboPulse 0.3s ease-out", border: "1px solid rgba(122,208,255,0.6)" }}>
                  😮‍💨 DODGE ×{rDodgeStreak}
                </div>
              )}
              {rChain >= 2 && (
                <div key={`chain${rChain}`} style={{ ...pill("#9dff7a"), animation: "worldComboPulse 0.3s ease-out", border: "1px solid rgba(157,255,122,0.6)" }}>
                  ⚡ CHAIN ×{rChain}
                </div>
              )}
              {rSaves > 0 && (
                <div key={`saves${rSaves}`} style={{ ...pill("#ffd27a"), animation: "worldComboPulse 0.3s ease-out", border: "1px solid rgba(255,210,122,0.6)" }}>
                  🛟 {rSaves} saved
                </div>
              )}
            </div>
            {/* MEGA-SURGE finale — the whole street is lit and NEPA is trying to
                collapse it. HOLD every breaker lit until this bar fills to win. The
                bar only advances while the street is 100% lit, so a trip stalls it. */}
            {rMegaActive && (
              <div style={{ width: "min(80vw,360px)", marginTop: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, color: "#ffd84a", textShadow: "0 2px 8px #000", marginBottom: 3 }}>
                  <span style={{ animation: "worldComboPulse 0.5s ease-out infinite" }}>⚡ MEGA-SURGE — HOLD THE LIGHT!</span>
                  <span>{Math.round(rMega * 100)}%</span>
                </div>
                <div style={{ height: 11, borderRadius: 999, background: "rgba(0,0,0,0.55)", overflow: "hidden", border: "1px solid rgba(255,216,74,0.55)", boxShadow: "0 0 16px rgba(255,180,40,0.5)" }}>
                  <div style={{ height: "100%", width: `${Math.round(rMega * 100)}%`, background: "linear-gradient(90deg,#fff07a,#ffb43a,#ff7a2f)", transition: "width 0.1s linear" }} />
                </div>
              </div>
            )}
            {/* HOSPITAL alarm — the VIP breaker is dying. Top-priority shout: losing
                it costs a life, so this overrides the quieter prompts. */}
            {rVipWarn && (
              <div style={{ fontSize: "clamp(15px,4.2vw,20px)", fontWeight: 900, color: "#fff", background: "rgba(200,30,25,0.82)", padding: "5px 14px", borderRadius: 10, textShadow: "0 1px 4px #000", animation: "worldComboPulse 0.35s ease-out infinite", border: "1px solid rgba(255,255,255,0.4)" }}>
                🏥 HOSPITAL FAILING — SAVE IT!
              </div>
            )}
            {/* Late-night pressure hint — the longer you take, the faster NEPA bites.
                A quiet nudge that the clock itself is now the enemy (speedrun teeth). */}
            {!rMegaActive && rIntensity > 0.55 && (
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: rIntensity > 0.8 ? "#ff8a5a" : "#ffc24d", textShadow: "0 1px 3px #000", opacity: 0.95 }}>
                {rIntensity > 0.8 ? "🌙 Deep night — NEPA dey vex, move sharp!" : "🌙 E dey late — trips dey come faster"}
              </div>
            )}
            {/* GRID STRAIN (brownout) meter — fills while breakers sit dark/dying;
                full = a total blackout (a life). The core triage pressure gauge. */}
            {!rMegaActive && rBrownout > 0.02 && (
              <div style={{ width: "min(72vw,320px)", marginTop: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, color: rBrownout > 0.66 ? "#ff6b6b" : "#ffb04a", textShadow: "0 1px 3px #000", marginBottom: 3 }}>
                  <span>⚠ GRID STRAIN</span>
                  {rBrownout > 0.66 && <span style={{ animation: "worldComboPulse 0.4s ease-out infinite" }}>BLACKOUT INCOMING</span>}
                </div>
                <div style={{ height: 7, borderRadius: 999, background: "rgba(0,0,0,0.5)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}>
                  <div style={{ height: "100%", width: `${Math.round(rBrownout * 100)}%`, background: rBrownout > 0.66 ? "linear-gradient(90deg,#ff8a3a,#ff3b2f)" : "linear-gradient(90deg,#ffd27a,#ffae3a)", transition: "width 0.1s linear" }} />
                </div>
              </div>
            )}
            {/* First breaker = a big guided coach prompt (teach-by-doing). The
                needle is slowed in the director so this first tap lands easy. */}
            {rRestored === 0 && rNearIdx != null && (
              <div style={{ marginTop: 2, fontSize: "clamp(16px,4.5vw,20px)", fontWeight: 900, color: "#4bed6a", textShadow: "0 2px 10px #000", animation: "worldComboPulse 0.6s ease-out infinite" }}>
                👆 TAP when the needle hits GREEN!
              </div>
            )}
            {/* A dying breaker you're lined up on → a loud SAVE prompt (overrides the
                early flip hint — triage urgency beats the tutorial). */}
            {rNearWarn && (
              <div style={{ marginTop: 2, fontSize: "clamp(15px,4vw,19px)", fontWeight: 900, color: "#ff5a3a", textShadow: "0 2px 10px #000", animation: "worldComboPulse 0.4s ease-out infinite" }}>
                🔥 SAVE IT — TAP in the green!
              </div>
            )}
            {/* Small hint for the next couple breakers, then it fades — the guide
                arrow + world-space meter carry it from there (progressive disclosure). */}
            {rRestored < 3 && !rNearWarn && !(rRestored === 0 && rNearIdx != null) && (
              <div style={{ color: rNearIdx != null ? "#4bed6a" : "#cfc7e8", fontSize: 13, fontWeight: 700, textShadow: "0 1px 4px #000", opacity: 0.95 }}>
                {rNearIdx != null ? "⚡ TAP when the marker hits the green!" : "Run to the glowing cyan breakers"}
              </div>
            )}
          </div>
        )}

        {/* Restore: FLIP / SAVE button (appears when you're on a breaker). Turns red
            and reads SAVE when the breaker you're on is dying (triage), green FLIP
            when it's an unlit breaker to restore. */}
        {appMode === "restore" && rState === "playing" && rNearIdx != null && (
          <button
            onClick={() => {
              worldControls.actionTap = true;
            }}
            style={{
              pointerEvents: "auto",
              position: "absolute",
              right: "max(18px, env(safe-area-inset-right))",
              bottom: "calc(30px + env(safe-area-inset-bottom))",
              zIndex: 20,
              padding: "16px 26px",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.3)",
              background: rNearWarn ? "linear-gradient(90deg,#ff6b3a,#e02a1e)" : "linear-gradient(90deg,#3ad64f,#1ea83a)",
              color: rNearWarn ? "#2a0603" : "#06230c",
              fontWeight: 900,
              fontSize: 18,
              cursor: "pointer",
              boxShadow: rNearWarn ? "0 6px 20px rgba(230,50,30,0.55)" : "0 6px 20px rgba(40,200,80,0.5)",
              animation: rNearWarn ? "worldComboPulse 0.4s ease-out infinite" : undefined,
            }}
          >
            {rNearWarn ? "🔥 SAVE" : "⚡ FLIP"}
          </button>
        )}

      </div>

      {/* ── Intro cold-open (tap anywhere to skip) ───────────────────────── */}
      {appMode === "intro" && (
        <div
          onClick={skipIntro}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 28,
            cursor: "pointer",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
            pointerEvents: "auto",
          }}
        >
          <span style={{ color: "#fff", opacity: 0.55, fontSize: 13, letterSpacing: 1, textShadow: "0 1px 6px #000" }}>
            tap to skip
          </span>
        </div>
      )}

      {/* ── Mode picker — an on-demand launcher, not a blocking screen ─────── */}
      {appMode === "menu" && !driving && modesOpen && (
        <ModeSelect touch={isMobile} onPick={pickFromLobby} friends={<FriendsPlay room={room} gameName="UP NEPA 3D" sharePath="/world" atStart part="button" dark />} />
      )}
      {/* "Play a mode" launcher: roam freely, open the picker when you want it. */}
      {appMode === "menu" && !driving && !modesOpen && (
        <button
          onClick={() => setModesOpen(true)}
          style={{
            position: "fixed", left: "50%", transform: "translateX(-50%)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 26px)", zIndex: 45,
            padding: "13px 26px", borderRadius: 999, border: "1px solid rgba(200,160,255,0.5)",
            cursor: "pointer", background: "linear-gradient(180deg, rgba(120,70,220,0.96), rgba(60,24,130,0.97))",
            color: "#fff", fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: 15,
            letterSpacing: "0.03em", boxShadow: "0 8px 22px rgba(80,40,160,0.5)",
          }}
        >
          Choose a mode
        </button>
      )}

      {/* ── Get off the keke — only while riding. Entering is contextual: walk up
            and tap the "Tap to ride" prompt on the vehicle. Shown in free-roam AND
            the game modes (where the keke is a fast-traversal option). */}
      {((appMode === "menu" && !modesOpen) || appMode === "restore" || appMode === "charge") && driving && (
        <button
          onClick={() => { worldControls.enterExit = true; }}
          style={{
            position: "fixed", right: 16,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 120px)", zIndex: 45,
            padding: "13px 24px", borderRadius: 999, border: "none", cursor: "pointer",
            background: "rgba(244,63,94,0.95)", color: "#fff",
            fontFamily: "system-ui, sans-serif", fontWeight: 900, fontSize: 15,
            letterSpacing: "0.04em", boxShadow: "0 8px 22px rgba(0,0,0,0.5)",
          }}
        >
          GET OFF
        </button>
      )}

      {/* ── Restore the Light START overlay ───────────────────────────────── */}
      {appMode === "restore" && rState === "idle" && !autoStart && (
        <div style={overlay}>
          <div style={card}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(244,241,234,0.62)" }}>UP NEPA · THE WHOLE AREA DON BLACKOUT</div>
            <h1 style={{ margin: "4px 0 0", fontFamily: HUD_DISPLAY, fontSize: "clamp(26px,7.5vw,36px)", fontWeight: 700, lineHeight: 1.05, color: "#fff" }}>Restore the Light</h1>
            <Steps
              items={[
                ["🏃", "Run to a glowing breaker"],
                ["🎯", "Tap when the marker hits green"],
                ["⏱️", "Light the whole street fast. Watch the road!"],
              ]}
            />
            <button style={primaryBtn} onClick={beginRestore}>Bring the light</button>
            <button onClick={toMenu} style={{ marginTop: 10, background: "none", border: "none", color: "#9b93b8", fontSize: 13, cursor: "pointer" }}>
              ← Modes
            </button>
          </div>
        </div>
      )}

      {/* friend room: the lobby sheet, who is how far, and the standings */}
      <FriendsPlay room={room} gameName="UP NEPA 3D" sharePath="/world" atStart={modesOpen} progressMax={10} progressWord="breaker" part="overlays" />

      {/* ── Restore the Light RESULT overlay ──────────────────────────────── */}
      {appMode === "restore" && (rState === "won" || rState === "over") && rSummary && !roomRun.current && (
        <div style={overlay}>
          <div style={card}>
            {rSummary.won && bestInfo.isBest && (
              <div
                key={`nb${rSummary.timeTaken}`}
                style={{ alignSelf: "center", fontSize: 12, fontWeight: 900, letterSpacing: 1.5, color: "#06230f", background: "linear-gradient(180deg,#ffe36a,#ffc93c)", borderRadius: 999, padding: "4px 12px", marginBottom: 6, animation: "worldComboPulse 0.4s ease-out" }}
              >
                ⭐ NEW BEST!
              </div>
            )}
            <div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.7, color: rSummary.won ? "#8ff0a4" : "#ffd27a" }}>
              {rSummary.won ? "UP NEPA! WHOLE AREA DON GET LIGHT" : rSummary.total - rSummary.restored <= 3 ? `SO CLOSE! ONLY ${rSummary.total - rSummary.restored} MORE TO LIGHT THE AREA` : `YOU BROUGHT LIGHT TO ${rSummary.restored} ${rSummary.restored === 1 ? "SHOP" : "SHOPS"}`}
            </div>
            {rSummary.won && rSummary.timeTaken != null ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, margin: "8px 0 2px" }}>
                <span style={{ fontFamily: HUD_DISPLAY, fontSize: "clamp(34px,10vw,54px)", fontWeight: 700, color: "#8ff0a4" }}>{rSummary.timeTaken.toFixed(1)}s</span>
                {(() => {
                  const g = gradeFor(rSummary.timeTaken);
                  return (
                    <span style={{ fontSize: "clamp(26px,7vw,42px)", fontWeight: 900, color: g.color, border: `3px solid ${g.color}`, borderRadius: 12, padding: "2px 12px", lineHeight: 1.2 }}>
                      {g.label}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <div style={{ margin: "10px 0 2px", fontFamily: HUD_DISPLAY, fontSize: "clamp(34px,10vw,54px)", fontWeight: 700, color: "#ffd27a" }}>
                {rSummary.restored}/{rSummary.total}
              </div>
            )}
            {rSummary.won && rSummary.timeTaken != null && (() => {
              const n = nextGrade(rSummary.timeTaken);
              return n ? (
                <div style={{ margin: "2px 0 6px", fontSize: 15, fontWeight: 600, color: "#f4f1ea" }}>
                  Only <b style={{ color: n.color }}>{Math.max(0.1, n.gap).toFixed(1)}s</b> from grade <b style={{ color: n.color }}>{n.label}</b>
                </div>
              ) : (
                <div style={{ margin: "2px 0 6px", fontSize: 15, fontWeight: 600, color: "#ffd700" }}>Top grade. Now beat your own time.</div>
              );
            })()}
            <div style={{ color: "#cfc7e8", fontSize: 14 }}>
              {rSummary.won ? `all ${rSummary.total} breakers lit` : `${rSummary.restored}/${rSummary.total} breakers lit`}
            </div>
            {/* the score and exactly where it came from. No ceiling: skill keeps adding. */}
            <div style={{ margin: "8px auto 2px", maxWidth: 330, padding: "9px 14px", borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6 }}>
                <b style={{ fontSize: 26, color: "#ffd56b", fontVariantNumeric: "tabular-nums" }}>{rSummary.score}</b>
                <span style={{ fontSize: 12, color: "#9b93b8", fontWeight: 600 }}>pts</span>
              </div>
              {rHigh && (
                <div style={{ marginTop: 2, fontSize: 12.5, fontWeight: 700, color: rHigh.isNew ? "#ffd56b" : "#9b93b8" }}>
                  {rHigh.isNew ? (rHigh.prev == null ? "🏆 Your first high score" : `🏆 New high score! +${rSummary.score - rHigh.prev} on your old best`) : `High score ${rHigh.best} · ${rHigh.best - rSummary.score} more to beat it`}
                </div>
              )}
              {rSummary.parts && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 6 }}>
                  {([["Breakers", rSummary.parts.breakers, SCORE_MAX.breakers, "#8ff0a4"], ["Speed", rSummary.parts.speed, SCORE_MAX.speed, "#7fb8ff"], ["Skill", rSummary.parts.skill, 0, "#ff9ad5"]] as const).map(([label, v, max, c]) => (
                    <div key={label} style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", color: "#9b93b8", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#f4f1ea", fontVariantNumeric: "tabular-nums" }}>{max ? v : `+${v}`}{max > 0 && <span style={{ color: "#6f6890", fontWeight: 600 }}>/{max}</span>}</div>
                      <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", marginTop: 3, overflow: "hidden" }}><div style={{ width: `${max ? Math.round((v / max) * 100) : Math.min(100, Math.round((v / 400) * 100))}%`, height: "100%", background: c }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {rSummary.won && rSummary.timeTaken != null && bestInfo.prevBest != null && (
              <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 700, color: bestInfo.isBest ? "#8ff0a4" : "#9b93b8" }}>
                {bestInfo.isBest
                  ? `−${(bestInfo.prevBest - rSummary.timeTaken).toFixed(1)}s vs your best`
                  : `your best ${bestInfo.prevBest.toFixed(1)}s`}
              </div>
            )}
            <div role="status" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, color: "rgba(244,241,234,0.78)" }}>
              {!rankedRound ? (ranked.canRank ? "This round was not ranked." : <>Sign in to rank your score. <a href="/home?signin=1" style={{ color: "#ffd56b" }}>Sign in</a></>)
                : ranked.status === "checking" ? "Checking your run…"
                : ranked.status === "wallet" ? "Confirm in your wallet to save…"
                : ranked.status === "saving" ? "Saving to the leaderboard…"
                : ranked.status === "saved" ? <>{ranked.result?.queued ? "Saved · confirming on-chain" : "Saved on-chain"}{ranked.result ? ` · ${ranked.result.score} pts` : ""}{ranked.result?.rank ? ` · rank #${ranked.result.rank}` : ""}{ranked.result?.txHash ? <> · <a href={`https://celoscan.io/tx/${ranked.result.txHash}`} target="_blank" rel="noreferrer" style={{ color: "#ffd56b" }}>view</a></> : null}</>
                : ranked.status === "error" ? ranked.error : null}
              {" "}<a href="/world/leaderboard" style={{ color: "#ffd56b" }}>Leaderboard</a>
            </div>
            <button style={{ ...primaryBtn, marginTop: 18, fontSize: 18, padding: "14px 0" }} onClick={beginRestore}>▶ Play again</button>
            <button onClick={toMenu} style={{ marginTop: 10, background: "none", border: "none", color: "#9b93b8", fontSize: 13, cursor: "pointer" }}>
              ← Modes
            </button>
          </div>
        </div>
      )}

      {/* ── Charge Rush START overlay ─────────────────────────────────── */}
      {appMode === "charge" && mode === "idle" && !autoStart && (
        <div style={overlay}>
          <div style={card}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.22em", fontWeight: 600, color: "rgba(244,241,234,0.62)" }}>UP NEPA · LIGHT DON COME</div>
            <h1 style={{ margin: "4px 0 0", fontFamily: HUD_DISPLAY, fontSize: "clamp(26px,7.5vw,36px)", fontWeight: 700, lineHeight: 1.05, color: "#fff" }}>
              Charge Rush
            </h1>
            <Steps
              items={[
                ["🔌", "Light don come! You get only 3 sockets"],
                ["🏃", "Carry your devices to the sockets. Big ones pay more but charge slow"],
                ["⚠️", "When the light flickers, NEPA dey come. Anything not full, you lose"],
              ]}
            />
            <button style={primaryBtn} onClick={beginRound}>
              Start charging
            </button>
            <div style={{ marginTop: 10, color: "#9b93b8", fontSize: 12 }}>
              {isMobile ? "Stick to move · drag to look" : "WASD to move · drag to look"}
            </div>
          </div>
        </div>
      )}

      {/* ── Charge Rush GAME OVER overlay ─────────────────────────────── */}
      {appMode === "charge" && mode === "over" && summary && (
        <div style={overlay}>
          <div style={card}>
            <div style={{ fontSize: 13, letterSpacing: 2, opacity: 0.7, color: "#ffd27a" }}>🌑 NEPA DON CARRY LIGHT FOR GOOD</div>
            <div style={{ margin: "10px 0 2px", fontFamily: HUD_DISPLAY, fontSize: "clamp(34px,10vw,54px)", fontWeight: 700, color: "#8ff0a4" }}>
              {naira(summary.score)}
            </div>
            <div style={{ color: "#cfc7e8", fontSize: 14 }}>from {summary.banked} device{summary.banked === 1 ? "" : "s"} charged before NEPA took light</div>
            {cHigh && (
              <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: cHigh.isNew ? "#ffd56b" : "#9b93b8" }}>
                {cHigh.isNew ? (cHigh.prev == null ? "🏆 Your first high score" : `🏆 New high score! ${naira(summary.score - cHigh.prev)} more than your old best`) : `High score ${naira(cHigh.best)} · ${naira(cHigh.best - summary.score)} more to beat it`}
              </div>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <span style={pill("#ffb8f0")}>🔥 Best streak ×{streakMult(summary.bestCombo)} ({summary.bestCombo})</span>
            </div>
            {summary.best && (
              <div style={{ marginTop: 10, color: "#ffd27a", fontSize: 13 }}>
                🏆 Biggest grab: {summary.best.label} ({naira(summary.best.value)})
              </div>
            )}
            <button style={{ ...primaryBtn, marginTop: 18 }} onClick={beginRound}>
              ▶ Play again
            </button>
            <button onClick={toMenu} style={{ marginTop: 10, background: "none", border: "none", color: "#9b93b8", fontSize: 13, cursor: "pointer" }}>
              ← Modes
            </button>
          </div>
        </div>
      )}

      {/* Pidgin shout on big events */}
      {shoutKey > 0 && appMode !== "menu" && (
        <div
          key={`shout${shoutKey}`}
          style={{
            position: "absolute",
            top: "30%",
            left: 0,
            right: 0,
            textAlign: "center",
            pointerEvents: "none",
            zIndex: 16,
            animation: "worldShout 1.05s ease-out forwards",
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontWeight: 900,
              fontStyle: "italic",
              fontSize: "clamp(26px, 8vw, 54px)",
              letterSpacing: 0.5,
              color: shoutTone === "bad" ? "#ff8a8a" : shoutTone === "big" ? "#ffe14d" : "#8ff0a4",
              textShadow: "0 3px 0 rgba(0,0,0,0.55), 0 0 24px rgba(0,0,0,0.5)",
              transform: "rotate(-4deg)",
            }}
          >
            {shoutText}
          </span>
        </div>
      )}

      {/* Screen flash on a hit (gold + brighter on a PERFECT) */}
      {fxKey > 0 && (
        <div
          key={`fx${fxKey}`}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 15,
            background:
              fxKind === "shock"
                ? "radial-gradient(ellipse at center, rgba(130,200,255,0) 40%, rgba(90,170,255,0.5) 100%)"
                : fxBig
                  ? "radial-gradient(ellipse at center, rgba(255,220,120,0) 38%, rgba(255,205,90,0.42) 100%)"
                  : "radial-gradient(ellipse at center, rgba(255,255,255,0) 55%, rgba(150,240,185,0.16) 100%)",
            animation: `worldFxFlash ${fxKind === "shock" ? 0.26 : fxBig ? 0.42 : 0.3}s ease-out forwards`,
          }}
        />
      )}

      {!lobbyOpen && appMode !== "intro" && <Joystick />}

      <style>{`
        @keyframes worldFxFlash {
          0% { opacity: 0.85; }
          100% { opacity: 0; }
        }
        @keyframes worldShout {
          0% { transform: translateY(14px) scale(0.6); opacity: 0; }
          18% { transform: translateY(0) scale(1.12); opacity: 1; }
          40% { transform: translateY(-4px) scale(1); opacity: 1; }
          100% { transform: translateY(-40px) scale(0.95); opacity: 0; }
        }
        @keyframes worldNepaPop {
          0% { transform: scale(0.8); opacity: 0; }
          60% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes worldComboPulse {
          0% { transform: scale(0.75); }
          60% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @keyframes worldBankPop {
          0% { transform: translateY(0) scale(0.7); opacity: 0; }
          25% { transform: translateY(-6px) scale(1.08); opacity: 1; }
          70% { transform: translateY(-26px) scale(1); opacity: 1; }
          100% { transform: translateY(-54px) scale(0.95); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
