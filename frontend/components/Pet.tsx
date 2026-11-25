"use client";

// The pet, alive. One component for every place a slime is shown.
//
// It has a resting mood (happy, sad or sleepy, decided by the caller from what
// the player has done), and passing reactions on top of it: a blink every few
// seconds, joy when it is poked or when the caller fires a `burst`.
//
// Each mood is its own rendered face of the same 3D model, so swapping the
// picture changes the expression and nothing else. The frames are stacked and
// cross-shown by opacity, so a swap never flickers. Movement (breathing, a hop,
// a droop, slow sleep) is CSS on the wrapper; see "Pet" in globals.css.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { petFrame, type PetMood } from "@/lib/pets";

export interface PetBurst { mood: "joy" | "sad"; ts: number; ms?: number }

export default function Pet({
  stage, mood = "happy", size, burst = null, interactive = false, filter, alt = "", style,
}: {
  stage: { id: string; name?: string };
  /** the resting mood */
  mood?: "happy" | "sad" | "sleepy";
  size: number;
  /** a passing reaction from outside: a win, a wrong answer. A new `ts` plays it again. */
  burst?: PetBurst | null;
  /** tapping the pet pokes it */
  interactive?: boolean;
  filter?: string;
  alt?: string;
  style?: CSSProperties;
}) {
  const egg = stage.id === "egg";
  const small = size <= 64;
  const [blink, setBlink] = useState(false);
  const [passing, setPassing] = useState<"joy" | "sad" | null>(null);
  const [poke, setPoke] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const still = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const shown: PetMood = passing ?? mood;

  // a blink now and then, only while the eyes are open and it is content
  useEffect(() => {
    if (egg || still || shown !== "happy") { setBlink(false); return; }
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { setBlink(true); setTimeout(() => setBlink(false), 140); next(); }, 2200 + Math.random() * 3400); };
    next();
    return () => clearTimeout(t);
  }, [egg, still, shown]);

  const burstTs = burst?.ts;
  useEffect(() => {
    if (!burst) return;
    setPassing(burst.mood);
    const t = setTimeout(() => setPassing(null), burst.ms ?? 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstTs]);

  const onPoke = () => {
    setPoke((n) => n + 1);
    if (!egg) { setPassing("joy"); later(() => setPassing(null), 1300); }
    try { navigator.vibrate?.(12); } catch { /* no haptics here */ }
  };

  // only the faces this pet can show are mounted
  const faces = useMemo(() => {
    if (egg) return ["happy"] as PetMood[];
    const set = new Set<PetMood>([mood]);
    if (mood === "happy" && !still) set.add("blink");
    if (interactive || burst) set.add("joy");
    if (burst) set.add("sad");
    if (passing) set.add(passing);
    return [...set];
  }, [egg, mood, still, interactive, burst, passing]);
  const active: PetMood = egg ? "happy" : shown === "happy" && blink ? "blink" : shown;

  const cls = ["pet", egg ? "pet--egg" : `pet--${shown}`, still ? "pet--still" : ""].join(" ");
  const body = (
    <span key={poke} className={poke ? "pet-body pet-body--poke" : "pet-body"}>
      {faces.map((f) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={f} src={petFrame(stage, f, small)} alt={f === active ? alt : ""} aria-hidden={f !== active} draggable={false} width={size} height={size} decoding="async"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: f === active ? 1 : 0, filter }} />
      ))}
    </span>
  );
  const frame: CSSProperties = { width: size, height: size, ["--pet" as string]: `${size}px`, ...style };
  return interactive ? (
    <button type="button" className={cls} style={frame} onClick={onPoke} aria-label={alt || stage.name || "Your pet"}>
      {body}
      {!egg && shown === "sleepy" && !still && <span className="pet-zz" aria-hidden><i>z</i><i>z</i><i>Z</i></span>}
      {!egg && shown === "joy" && !still && <span className="pet-spark" aria-hidden><i>✦</i><i>✦</i><i>✦</i></span>}
    </button>
  ) : (
    <span className={cls} style={frame}>
      {body}
      {!egg && shown === "sleepy" && !still && size > 64 && <span className="pet-zz" aria-hidden><i>z</i><i>z</i><i>Z</i></span>}
      {!egg && shown === "joy" && !still && size > 64 && <span className="pet-spark" aria-hidden><i>✦</i><i>✦</i><i>✦</i></span>}
    </span>
  );
}
