"use client";

import { useEffect, useState } from "react";

// ─── Verified Tug of War — the battle ────────────────────────────────────────
// This is the hero of the event, so it is built to read as a live contest
// rather than a progress bar. Four things carry that:
//
//  TERRITORY. The screen itself is the battlefield — each team's colour bleeds
//  in from its own edge, and the intensity tracks the score. A player glances
//  once and knows who is winning before reading a single number.
//
//  MASS. The rope is thick, seated in a recessed channel, with a heavy medallion
//  at the front line. A 6px hairline reads as a loading bar; this reads as
//  something two crowds are hauling on.
//
//  IDENTITY. Teams get crests that light up when they lead and dim when they
//  trail. "Red" and "Blue" have to feel like sides you belong to.
//
//  LIFE. One slow pulse on the contested seam. Exactly one thing breathes, so
//  it signals "live" instead of "busy".
//
// Performance discipline is unchanged and non-negotiable: this audience is on
// mid-range Android over mobile data, so only transform and opacity animate,
// there are no blur filters in the animated path, and everything collapses
// under prefers-reduced-motion.
//
// COLOUR. Tailwind red-500 vs blue-500 measure 1.02:1 against each other —
// luminance twins that become two identical grey bars under deuteranopia, and
// red-500 additionally collides with the #22c55e "verified" green at 1.65:1 on
// an event built entirely around verification. #dc2626 / #67e8f9 measures
// 3.33:1, and BLUE is deliberately the light side so the split survives
// greyscale, JPEG and a WhatsApp status repost. Colour never carries meaning
// alone: text labels at both ends, stripes on red, solid on blue, and the
// medallion's offset is itself an encoding that needs no colour at all.

export const TEAM_RED = "#dc2626";
// Red as TEXT, not as a shape. #dc2626 measures 3.15:1 on the lightest
// backdrop: fine for a crest or a tint, where 3:1 is the bar for a graphical
// object, but a fail for the 8.5 and 10.5px labels that used it. This reads
// 8.01:1. Blue needs no such split, it is already 9.4:1 as text.
export const TEAM_RED_TEXT = "#fca5a5";
export const TEAM_RED_DEEP = "#7f1d1d";
export const TEAM_BLUE = "#67e8f9";
export const TEAM_BLUE_DEEP = "#0e7490";
export const ROPE_CAP = 0.55;
const ROPE_CURVE = 0.6;

/** Mirrors games-backend/lib/tugScoring.js — the client renders optimistically
 *  between polls, so it must agree with the server rather than approximate it. */
// Signed travel as a FRACTION of the rope's half length, in [-1, 1].
//
// This used to return pixels against a fixed maxPx of 130, tuned for the 480px
// max-width case where the rope's half length is 128px. The rope is inset 96px
// on both sides, so its half length is (containerWidth - 192) / 2: 68px on a
// 360px phone, 83px at 390, 94px at 412. A 130px offset therefore threw the
// knot clean off the end of the rope and onto the crowd on every common phone,
// and overshot by 2px even at 480. Returning a fraction lets the knot be
// positioned in percent, so it scales with whatever the rope actually measures.
export function ropeOffset(red: number, blue: number, maxPx = 1): number {
  const total = Number(red) + Number(blue);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const lead = (red / total - 0.5) * 2;
  const mag = Math.min(1, Math.pow(Math.abs(lead) / ROPE_CAP, ROPE_CURVE));
  return Math.sign(lead) * mag * maxPx;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export interface TugRopeProps {
  red: number;
  blue: number;
  redHumans: number;
  blueHumans: number;
  updatedSecondsAgo?: number;
  myTeam?: "red" | "blue" | null;
}

export default function TugRope({
  red, blue, redHumans, blueHumans, updatedSecondsAgo, myTeam,
}: TugRopeProps) {
  const reduced = usePrefersReducedMotion();

  const frac = ropeOffset(red, blue);                 // -1 .. 1
  const maxed = Math.abs(frac) >= 0.995;
  // Percent of the ROPE's width, measured from its centre. 36 keeps the 38px
  // knot's outer edge on the rope at the narrowest phone: 50 - 36 = 14% of a
  // 136px rope is 19px, exactly the knot's radius.
  const knotPct = frac * 36;
  // The crowds are anchored outside the rope, so they keep a pixel drag. 23px
  // against their 26px inset is the value the old 130px offset produced at
  // full lead, kept identical so the crowds look unchanged.
  const crowdPx = frac * 23;
  const lead = Math.abs(red - blue);
  const leader: "red" | "blue" | null = red === blue ? null : red > blue ? "red" : "blue";

  return (
    <section
      aria-label="Tug of war standings"
      style={{ position: "relative", width: "100%", paddingTop: 4 }}
    >
      <style>{`
        @keyframes tug-seam { 0%,100% { opacity: .35 } 50% { opacity: .9 } }
        @keyframes tug-live { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
        @keyframes tug-strain { 0%,100% { translate: 0 0 } 50% { translate: 0 -2px } }
      `}</style>

      {/* ── Crest + score, one row per team ───────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <TeamBlock
          side="left" label="RED" colour={TEAM_RED} text={TEAM_RED_TEXT} deep={TEAM_RED_DEEP}
          score={red} humans={redHumans} leading={leader === "red"} mine={myTeam === "red"}
        />
        <div style={{ flex: "0 0 auto", textAlign: "center", minWidth: 62 }}>
          <div style={{
            fontSize: 10, fontWeight: 900, letterSpacing: "0.14em",
            color: leader ? (leader === "red" ? TEAM_RED_TEXT : TEAM_BLUE) : "rgba(220,210,255,0.68)",
          }}>
            {leader ? "LEADS BY" : "LEVEL"}
          </div>
          <div style={{
            fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums",
          }}>
            {leader ? lead.toLocaleString() : "—"}
          </div>
        </div>
        <TeamBlock
          side="right" label="BLUE" colour={TEAM_BLUE} text={TEAM_BLUE} deep={TEAM_BLUE_DEEP}
          score={blue} humans={blueHumans} leading={leader === "blue"} mine={myTeam === "blue"}
        />
      </div>

      {/* ── The pull ────────────────────────────────────────────────────────
          Two crowds hauling on a rope, not a progress bar. The abstract bar
          answered "what is the number"; this answers "what is happening", and
          a player can picture it before they can read it.

          Note the direction flips once there are characters in the scene. A
          bar can flood toward the enemy (the TikTok PK convention), but the
          moment you draw people pulling, the physical reading takes over and
          it is unambiguous: the winning side DRAGS the losing side toward
          them. So a red lead pulls the knot — and both crowds — left, onto
          red's ground. The dotted line marks where the knot started, which is
          what makes "we are winning" legible at a glance.

          The slimes are the existing pet art, hue-rotated per team. Reusing the
          mascot keeps this unmistakably GameArena rather than generic sports
          furniture, and costs no new asset. ────────────────────────────── */}
      <div
        role="img"
        aria-label={`Red ${red} with ${redHumans} players, Blue ${blue} with ${blueHumans} players. ${
          leader ? `${leader === "red" ? "Red" : "Blue"} leads by ${lead}.` : "Scores are level."
        }`}
        style={{ position: "relative", height: 106, marginTop: 2 }}
      >
        {/* ground the crowds stand on — without it they float */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 32, height: 2,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.24) 10%, rgba(255,255,255,0.24) 90%, transparent)",
        }} />
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 18, height: 14,
          background: "linear-gradient(180deg, rgba(0,0,0,0.32), transparent)",
        }} />

        {/* where the knot started */}
        <div style={{
          position: "absolute", left: "50%", top: 0, bottom: 30, width: 0,
          borderLeft: "2px dotted rgba(255,255,255,0.28)", transform: "translateX(-1px)",
        }} />

        {/* ONE rope, not a two-tone bar.
            Splitting it red/blue was a leftover from the progress-bar version,
            and it broke the moment a side started winning: red pulls the knot
            toward red, which shrinks red's own segment to a stub and reads as a
            rendering fault. A real tug-of-war rope is a single rope — the KNOT
            carries the story, and the dotted line behind it marks where that
            knot started. Team colour lives on the crowds, where it belongs. */}
        <div style={{
          position: "absolute", left: 96, right: 96, bottom: 56, height: 7,
          borderRadius: 4, overflow: "hidden",
          // Hemp brown, not gold. The rope and the knot were both gold and
          // muddied into one shape; the knot has to be the thing your eye finds.
          background: "repeating-linear-gradient(115deg, #a8784a 0 5px, #7d5733 5px 9px, #5c3f24 9px 12px)",
          boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.45), 0 2px 5px rgba(0,0,0,0.4)",
        }} />

        <Crowd side="left"  colour={TEAM_RED}  text={TEAM_RED_TEXT} humans={redHumans}  offset={crowdPx} reduced={reduced} leading={leader === "red"} mine={myTeam === "red"} />
        <Crowd side="right" colour={TEAM_BLUE} text={TEAM_BLUE} humans={blueHumans} offset={crowdPx} reduced={reduced} leading={leader === "blue"} mine={myTeam === "blue"} />

        {/* The knot rides a track inset exactly like the rope, so a percentage
            here is a percentage OF THE ROPE and stays on it at any width. */}
        <div style={{ position: "absolute", left: 96, right: 96, top: 0, bottom: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", left: `calc(50% - ${knotPct.toFixed(2)}%)`, bottom: 43,
          width: 38, height: 38, marginLeft: -19,
          transition: reduced ? "none" : "left 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          borderRadius: "50%",
          background: "radial-gradient(circle at 34% 28%, #fff4c2, #f0b429 46%, #9a5b06)",
          border: "3px solid rgba(255,255,255,0.8)",
          boxShadow: `0 5px 14px rgba(0,0,0,0.55), 0 0 18px ${
            leader === "red" ? "rgba(220,38,38,0.6)" : leader === "blue" ? "rgba(103,232,249,0.55)" : "rgba(255,255,255,0.25)"
          }`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 17, willChange: "left", zIndex: 3,
        }}>
          🎮
        </div>
        </div>
      </div>

      {/* ── footnotes ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10.5, color: "rgba(220,210,255,0.6)", fontWeight: 700, marginTop: 4,
      }}>
        <span>{maxed ? `maxed · lead over ${Math.round(ROPE_CAP * 100)}%` : `maxes out at a ${Math.round(ROPE_CAP * 100)}% lead`}</span>
        {updatedSecondsAgo !== undefined && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3, background: "#22c55e",
              animation: reduced ? "none" : "tug-live 2s ease-in-out infinite",
            }} />
            {updatedSecondsAgo < 5 ? "live" : `${updatedSecondsAgo}s ago`}
          </span>
        )}
      </div>
    </section>
  );
}

function Crowd({ side, colour, text, humans, offset, reduced, leading, mine }: {
  side: "left" | "right"; colour: string; text: string; humans: number; offset: number;
  reduced: boolean; leading: boolean; mine?: boolean;
}) {
  const left = side === "left";
  // Show a handful and count the rest. Drawing 96 slimes would be unreadable at
  // 390px and tells a player nothing the number does not.
  const shown = Math.max(1, Math.min(3, Math.ceil(humans / 34) || 1));

  // Tinting the green mascot with a bare hue-rotate produced PINK, because
  // hue-rotate is a matrix approximation that skews on saturated sources.
  // Flattening to greyscale→sepia first gives a known base hue (~40deg) to
  // rotate from, so the teams land on real red and real cyan.
  const tint = left
    ? "grayscale(1) sepia(1) hue-rotate(-48deg) saturate(9) brightness(0.72)"
    : "grayscale(1) sepia(1) hue-rotate(152deg) saturate(3.4) brightness(1.1)";

  return (
    <div style={{
      // Inset far enough that the drag below can never push a crowd off the
      // edge: max drag is 23px against a 26px inset (computed by the caller).
      position: "absolute", [left ? "left" : "right"]: 26, bottom: 0,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      // The losing crowd gets dragged. Moving both by a fraction of the knot's
      // travel is what sells this as a pull rather than a slider.
      transform: `translateX(${-offset}px)`,
      transition: reduced ? "none" : "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      zIndex: 2,
    } as React.CSSProperties}>
      {/* slimes stand ON the ground line (34px up), rope crosses at hand height */}
      <div style={{ display: "flex", alignItems: "flex-end", marginBottom: 0, height: 52 }}>
        {Array.from({ length: shown }).map((_, i) => (
          <img
            key={i}
            src="/pets/stage-2-baby.png"
            alt=""
            style={{
              width: 46, height: 46, objectFit: "contain",
              marginLeft: i === 0 ? 0 : -17,
              filter: `${tint} drop-shadow(0 3px 5px rgba(0,0,0,0.5))`,
              // Lean into the pull, back rank leaning hardest.
              transform: `rotate(${(left ? -1 : 1) * (11 - i * 3)}deg)`,
              animation: reduced ? "none" : `tug-strain 1.7s ease-in-out ${i * 0.22}s infinite`,
            }}
          />
        ))}
      </div>
      {/* count sits BELOW the ground line so it never collides with it */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 999,
        background: leading ? `${colour}33` : "rgba(0,0,0,0.42)",
        border: `1px solid ${leading ? colour : "rgba(255,255,255,0.18)"}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: leading ? "#fff" : "rgba(255,255,255,0.78)", fontVariantNumeric: "tabular-nums" }}>
          {humans}
        </span>
        {mine && <span style={{ fontSize: 8.5, fontWeight: 900, color: text, letterSpacing: "0.08em" }}>YOU</span>}
      </div>
    </div>
  );
}

function TeamBlock({ side, label, colour, text, deep, score, humans, leading, mine }: {
  side: "left" | "right"; label: string; colour: string; text: string; deep: string;
  score: number; humans: number; leading: boolean; mine?: boolean;
}) {
  const right = side === "right";
  return (
    <div style={{
      flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9,
      flexDirection: right ? "row-reverse" : "row",
    }}>
      {/* crest — lit when leading, dimmed when trailing. Hierarchy without
          moving anything, so the row never reflows as the lead changes. */}
      <div style={{
        width: 42, height: 42, flexShrink: 0, borderRadius: 13,
        background: `linear-gradient(160deg, ${colour}, ${deep})`,
        border: `2px solid ${leading ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)"}`,
        boxShadow: leading ? `0 0 16px ${colour}88` : "none",
        opacity: leading ? 1 : 0.72,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: '"Melon Pop", system-ui, sans-serif', fontSize: 19, color: "#fff",
        textShadow: "0 1px 3px rgba(0,0,0,0.5)",
      }}>
        {label[0]}
      </div>
      <div style={{ minWidth: 0, textAlign: right ? "right" : "left" }}>
        <div style={{
          fontSize: 10.5, fontWeight: 900, letterSpacing: "0.1em", color: text,
          display: "flex", gap: 4, justifyContent: right ? "flex-end" : "flex-start",
          whiteSpace: "nowrap",
        }}>
          {label}{mine && <span style={{ color: "rgba(255,255,255,0.7)" }}>· YOU</span>}
        </div>
        <div style={{
          fontSize: 30, lineHeight: 1.05, fontWeight: 900,
          color: leading ? "#fff" : "rgba(255,255,255,0.7)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {score.toLocaleString()}
        </div>
        <div style={{ fontSize: 10.5, color: "rgba(220,210,255,0.68)", fontWeight: 700, whiteSpace: "nowrap" }}>
          {/* "qualified", not just "humans": a player who has joined a side but
              not yet played 3 games is on the team without counting for it, and
              "0 humans" next to their own team name reads as a fault. */}
          {humans} qualified
        </div>
      </div>
    </div>
  );
}
