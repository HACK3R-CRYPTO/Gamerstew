"use client";

import type { HabitatTier } from "@/lib/habitats";

// Layered habitat scenes. Every habitat follows the same architecture so the
// pet always reads cleanly:
//
//   1. Sky / space base       (atmospheric gradient)
//   2. Far silhouette         (depth horizon)
//   3. Ambient particles      (stars / pollen / spores)
//   4. Signature element      (the "wow" piece: throne, black hole, tree of life)
//   5. Mid-ground frame       (pillars, trees, crystals)
//   6. Stage spotlight        (radial highlight where the pet stands)
//   7. Vignette + accent ring (polish, focus the eye to center)
//
// Pure CSS/SVG. No image assets. GPU-friendly transforms only.

export function HabitatBackground({
  habitat,
  radius = 16,
  showLabel = false,
  glow = true,
}: {
  habitat: HabitatTier;
  radius?: number;
  showLabel?: boolean;
  glow?: boolean;
}) {
  const { name, type, bg } = habitat;

  return (
    <>
      <Anims />
      <div style={{
        position: "absolute", inset: 0,
        borderRadius: `${radius}px`,
        overflow: "hidden",
        zIndex: 0,
      }}>
        {/* Scene, wrapped in a vibrancy pass so every habitat reads crisp and
            saturated instead of muddy — one lever that lifts all 10 at once
            (shop cards + the pet-page background) without editing each scene. */}
        <div style={{
          position: "absolute", inset: 0,
          filter: "saturate(1.22) contrast(1.08) brightness(1.06)",
        }}>
          <Scene id={habitat.id} />
        </div>
        {/* Stage spotlight — keeps the pet readable on every habitat */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at 50% 75%, ${bg.accent}2e 0%, transparent 55%)`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }} />
        {/* Vignette — softened (edges no longer crush to near-black, which was
            the main thing making the scenes look murky at card size). */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 55%, transparent 48%, rgba(0,0,0,0.34) 100%)",
          pointerEvents: "none",
        }} />
        {/* Accent ring */}
        <div style={{
          position: "absolute", inset: 0,
          borderRadius: `${radius}px`,
          border: `1px solid ${bg.accent}66`,
          boxShadow: glow
            ? `inset 0 0 30px ${bg.accent}33, 0 0 18px ${bg.accent}33`
            : "none",
          pointerEvents: "none",
        }} />
      </div>

      {showLabel && (
        <div style={{
          position: "absolute", top: 8, left: 8,
          padding: "3px 8px", borderRadius: "999px",
          background: "rgba(0,0,0,0.55)",
          border: `1px solid ${bg.accent}77`,
          backdropFilter: "blur(6px)",
          zIndex: 5,
          display: "flex", alignItems: "center", gap: "5px",
        }}>
          {type === "paid" && (
            <span style={{ fontSize: "9px", color: bg.accent, fontWeight: 900 }}>★</span>
          )}
          <span style={{
            color: "rgba(255,255,255,0.95)",
            fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em",
            textShadow: `0 0 6px ${bg.accent}aa`,
          }}>
            {name.toUpperCase()}
          </span>
        </div>
      )}
    </>
  );
}

// ─── Scene router ────────────────────────────────────────────────────────────
function Scene({ id }: { id: number }) {
  switch (id) {
    case 1:  return <MysteryVoid />;
    case 2:  return <ForestGlade />;
    case 3:  return <StoneArena />;
    case 4:  return <CrystalCave />;
    case 5:  return <ThroneRoom />;
    case 6:  return <CelestialArena />;
    case 7:  return <MysticGarden />;
    case 8:  return <AstralRealm />;
    case 9:  return <CosmicThrone />;
    case 10: return <EternalSanctuary />;
    default: return null;
  }
}

// ── Animation definitions (single style block, mounted once per scene) ───────
const ANIMS = `
@keyframes hb-twinkle  { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@keyframes hb-float    { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes hb-driftY   { 0% { transform: translateY(0); opacity: 0.7; } 100% { transform: translateY(-180%); opacity: 0; } }
@keyframes hb-flicker  { 0%, 100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }
@keyframes hb-spin     { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes hb-spinSlow { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes hb-pulse    { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
@keyframes hb-aurora   { 0%, 100% { transform: translateX(-15%) skewX(-8deg); opacity: 0.5; } 50% { transform: translateX(15%) skewX(8deg); opacity: 0.85; } }
@keyframes hb-shimmer  { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@keyframes hb-rays     { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }
@keyframes hb-sway     { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
@keyframes hb-glitchH  { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); } }
@keyframes hb-shoot    { 0% { transform: translate(-100%, -50%) rotate(-25deg); opacity: 0; } 10%, 90% { opacity: 1; } 100% { transform: translate(100%, 50%) rotate(-25deg); opacity: 0; } }
@keyframes hb-orbit    { 0% { transform: rotate(0deg) translateX(28px) rotate(0deg); } 100% { transform: rotate(360deg) translateX(28px) rotate(-360deg); } }
`;

function Anims() {
  return <style dangerouslySetInnerHTML={{ __html: ANIMS }} />;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function Stars({ count, color = "#fff" }: { count: number; color?: string }) {
  // Deterministic positions so every render is stable (no SSR flash).
  const rng = mulberry(count * 7919);
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const top  = rng() * 92;
        const left = rng() * 100;
        const size = rng() * 2 + 0.8;
        const delay = rng() * 3;
        const dur = 1.8 + rng() * 2.5;
        return (
          <div key={i} style={{
            position: "absolute", top: `${top}%`, left: `${left}%`,
            width: size, height: size,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 ${size * 2.5}px ${color}`,
            animation: `hb-twinkle ${dur}s ease-in-out ${delay}s infinite`,
          }} />
        );
      })}
    </>
  );
}

// Tiny seedable PRNG so star fields are stable per count.
function mulberry(seed: number) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── FREE TIERS — real-life environments matching pet evolution ──────────────

// Tier 1 — Cozy Nest. The egg lives here. Twigs woven into a nest sitting
// on a tree branch with morning warmth filtering through.
function MysteryVoid() {
  return (
    <>
      {/* Warm dawn cave glow */}
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 70%, #78350f 0%, #4a2c1a 50%, #2e1a0e 100%)" }} />
      {/* Soft warm light from above */}
      <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: "50%",
        background: "radial-gradient(ellipse at 50% 0%, rgba(254,243,199,0.4) 0%, transparent 70%)", filter: "blur(8px)" }} />
      {/* Tree branch silhouette across top */}
      <div style={{ position: "absolute", top: "8%", left: "-5%", right: "-5%", height: "12%",
        background: "linear-gradient(180deg, #1a0f08 0%, #2e1a0e 100%)",
        clipPath: "polygon(0% 100%, 8% 30%, 20% 60%, 35% 20%, 55% 50%, 75% 25%, 90% 55%, 100% 35%, 100% 100%)" }} />
      {/* The nest — woven twigs as concentric arcs */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "65%" }}>
        <defs>
          <linearGradient id="nest-twigs" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#92400e" />
            <stop offset="100%" stopColor="#451a03" />
          </linearGradient>
        </defs>
        {/* Outer nest bowl */}
        <ellipse cx="50" cy="100" rx="55" ry="40" fill="url(#nest-twigs)" />
        <ellipse cx="50" cy="100" rx="50" ry="36" fill="#5c2e0d" />
        <ellipse cx="50" cy="100" rx="44" ry="32" fill="#3d1d08" />
        {/* Twig texture lines */}
        {[10, 25, 40, 55, 70, 85].map((x, i) => (
          <path key={i} d={`M ${x} 100 Q ${x + 4} ${85 - i * 2} ${x + 8} ${78 - i * 3}`}
            stroke="#78350f" strokeWidth="0.6" fill="none" opacity="0.7" />
        ))}
        {[15, 30, 45, 60, 75].map((x, i) => (
          <path key={i} d={`M ${x} 100 Q ${x - 3} ${82 - i * 2} ${x - 7} ${74 - i * 2}`}
            stroke="#a16207" strokeWidth="0.5" fill="none" opacity="0.6" />
        ))}
      </svg>
      {/* A few feathers */}
      {[{ l: "18%", t: "55%", r: -20 }, { l: "75%", t: "50%", r: 15 }].map((f, i) => (
        <div key={i} style={{
          position: "absolute", left: f.l, top: f.t,
          width: 18, height: 6, borderRadius: "60% 60% 60% 60%",
          background: "linear-gradient(90deg, #fef3c7 0%, #fbbf24 50%, transparent 100%)",
          transform: `rotate(${f.r}deg)`,
          opacity: 0.75,
          animation: `hb-sway 5s ease-in-out ${i * 0.5}s infinite`,
        }} />
      ))}
      {/* Dust motes in the warm light */}
      {[
        { l: "30%", t: "20%", d: 0 }, { l: "60%", t: "15%", d: 1 },
        { l: "45%", t: "30%", d: 2 },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          width: 3, height: 3, borderRadius: "50%",
          background: "#fef3c7",
          boxShadow: "0 0 4px #fbbf24",
          animation: `hb-twinkle 3s ease-in-out ${p.d}s infinite`,
        }} />
      ))}
    </>
  );
}

// Tier 2 — Sunny Meadow. Baby slime's first playground. Open field, blue sky,
// rolling hills, wildflowers, butterflies.
function ForestGlade() {
  return (
    <>
      {/* Sky → grass gradient */}
      <div style={{ position: "absolute", inset: 0,
        background: "linear-gradient(180deg, #93c5fd 0%, #bae6fd 25%, #fef9c3 40%, #86efac 55%, #16a34a 90%, #166534 100%)" }} />
      {/* Sun */}
      <div style={{
        position: "absolute", top: "10%", right: "12%",
        width: "16%", aspectRatio: "1", borderRadius: "50%",
        background: "radial-gradient(circle, #fef3c7 0%, #fbbf24 60%, transparent 100%)",
        boxShadow: "0 0 24px #fde047",
        animation: "hb-pulse 5s ease-in-out infinite",
      }} />
      {/* Soft clouds */}
      <div style={{ position: "absolute", top: "18%", left: "10%", width: "25%", height: "10%",
        background: "rgba(255,255,255,0.8)", borderRadius: "50%", filter: "blur(4px)" }} />
      <div style={{ position: "absolute", top: "12%", left: "55%", width: "18%", height: "8%",
        background: "rgba(255,255,255,0.6)", borderRadius: "50%", filter: "blur(4px)" }} />
      {/* Rolling hills back */}
      <div style={{ position: "absolute", bottom: "30%", left: 0, right: 0, height: "25%",
        background: "linear-gradient(180deg, #4ade80 0%, #22c55e 100%)",
        clipPath: "polygon(0% 100%, 0% 60%, 15% 40%, 30% 55%, 50% 30%, 70% 50%, 85% 35%, 100% 55%, 100% 100%)" }} />
      {/* Wildflowers scattered */}
      {[
        { l: "12%", b: "15%", c: "#f472b6", d: 0 },
        { l: "28%", b: "10%", c: "#fbbf24", d: 0.5 },
        { l: "45%", b: "12%", c: "#a78bfa", d: 1 },
        { l: "62%", b: "8%", c: "#f472b6", d: 1.4 },
        { l: "78%", b: "14%", c: "#fbbf24", d: 0.3 },
        { l: "88%", b: "10%", c: "#a78bfa", d: 1.7 },
      ].map((f, i) => (
        <div key={i} style={{
          position: "absolute", left: f.l, bottom: f.b,
          width: 8, height: 8,
          animation: `hb-sway ${4 + i * 0.2}s ease-in-out ${f.d}s infinite`,
          transformOrigin: "bottom center",
        }}>
          <div style={{ position: "absolute", bottom: 0, left: "45%", width: "10%", height: "70%",
            background: "#15803d" }} />
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "60%",
            background: f.c, borderRadius: "50% 50% 50% 50%",
            boxShadow: `0 0 4px ${f.c}` }} />
          <div style={{ position: "absolute", top: "20%", left: "30%", width: "40%", height: "30%",
            background: "#fde047", borderRadius: "50%" }} />
        </div>
      ))}
      {/* Butterflies */}
      {[
        { l: "25%", t: "35%", d: 0 }, { l: "70%", t: "45%", d: 1.2 },
      ].map((b, i) => (
        <div key={i} style={{
          position: "absolute", left: b.l, top: b.t,
          width: 12, height: 8,
          animation: `hb-float 3s ease-in-out ${b.d}s infinite`,
        }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: "45%", height: "100%",
            background: "#f472b6", borderRadius: "50% 0 50% 50%",
            animation: `hb-flicker 0.3s ease-in-out infinite` }} />
          <div style={{ position: "absolute", right: 0, top: 0, width: "45%", height: "100%",
            background: "#fbbf24", borderRadius: "0 50% 50% 50%",
            animation: `hb-flicker 0.3s ease-in-out infinite` }} />
        </div>
      ))}
      {/* Foreground grass blades */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "8%",
        background: "linear-gradient(0deg, #14532d 0%, transparent 100%)" }} />
    </>
  );
}

// Tier 3 — Ancient Forest. Teen slime exploring. Tall trees, dappled
// sunlight, dense canopy, mossy floor.
function StoneArena() {
  return (
    <>
      {/* Forest depth */}
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 30%, #14532d 0%, #052e16 60%, #022c12 100%)" }} />
      {/* Sunbeams through canopy */}
      {[15, 35, 55, 75].map((l, i) => (
        <div key={i} style={{
          position: "absolute", top: 0, left: `${l}%`,
          width: "10%", height: "75%",
          background: "linear-gradient(180deg, rgba(254,240,138,0.45) 0%, rgba(254,240,138,0.15) 50%, transparent 100%)",
          transform: "skewX(-10deg)",
          filter: "blur(4px)",
          animation: `hb-rays ${3 + i * 0.5}s ease-in-out ${i * 0.3}s infinite`,
        }} />
      ))}
      {/* Far tree silhouettes */}
      <div style={{ position: "absolute", bottom: "18%", left: 0, right: 0, height: "65%", opacity: 0.6,
        background: "linear-gradient(180deg, #052e16 0%, #022c12 100%)",
        clipPath: "polygon(0% 100%, 0% 50%, 8% 60%, 12% 25%, 20% 40%, 26% 15%, 35% 35%, 42% 20%, 50% 30%, 58% 18%, 66% 35%, 75% 22%, 82% 40%, 90% 25%, 100% 45%, 100% 100%)" }} />
      {/* Foreground tree trunks (left) */}
      <div style={{ position: "absolute", bottom: 0, left: "-3%", width: "12%", height: "100%",
        background: "linear-gradient(90deg, #1a0f08 0%, #451a03 50%, #1a0f08 100%)",
        clipPath: "polygon(20% 0%, 50% 0%, 60% 100%, 30% 100%)",
        boxShadow: "inset -4px 0 8px rgba(0,0,0,0.5)" }} />
      {/* Foreground tree trunks (right) */}
      <div style={{ position: "absolute", bottom: 0, right: "-2%", width: "14%", height: "100%",
        background: "linear-gradient(90deg, #1a0f08 0%, #451a03 50%, #1a0f08 100%)",
        clipPath: "polygon(40% 0%, 70% 0%, 80% 100%, 50% 100%)",
        boxShadow: "inset 4px 0 8px rgba(0,0,0,0.5)" }} />
      {/* Canopy leaves at top — lush green */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30%",
        background: "radial-gradient(ellipse at 30% 100%, #166534 0%, transparent 60%), radial-gradient(ellipse at 70% 100%, #15803d 0%, transparent 60%), linear-gradient(180deg, #14532d 0%, transparent 100%)" }} />
      {/* Floating leaves */}
      {[
        { l: "30%", t: "40%", d: 0, c: "#16a34a" },
        { l: "65%", t: "50%", d: 1.5, c: "#22c55e" },
        { l: "45%", t: "65%", d: 0.8, c: "#65a30d" },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          width: 6, height: 4, borderRadius: "70% 30% 70% 30%",
          background: p.c,
          boxShadow: `0 0 4px ${p.c}88`,
          animation: `hb-driftY 6s ease-out ${p.d}s infinite`,
          transform: `rotate(${i * 30}deg)`,
        }} />
      ))}
      {/* Mossy ground */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "15%",
        background: "linear-gradient(0deg, #052e16 0%, transparent 100%)" }} />
    </>
  );
}

// Tier 4 — Crystal Cavern. Pet has discovered a real cave with stalactites
// hanging from the ceiling, geodes glowing in the walls, water dripping.
function CrystalCave() {
  return (
    <>
      {/* Cave depth */}
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 70%, #075575 0%, #04293d 50%, #02141f 100%)" }} />
      {/* Cave wall texture (rough rock) */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.25,
        backgroundImage: "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.4) 2%, transparent 8%), radial-gradient(circle at 60% 70%, rgba(0,0,0,0.4) 2%, transparent 8%), radial-gradient(circle at 80% 20%, rgba(0,0,0,0.3) 2%, transparent 8%)",
        backgroundSize: "40% 30%, 35% 30%, 50% 40%" }} />
      {/* Rounded cave ceiling silhouette */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "20%",
        background: "linear-gradient(180deg, #02141f 0%, transparent 100%)",
        borderRadius: "0 0 50% 50% / 0 0 100% 100%" }} />
      {/* Stalactites hanging from ceiling */}
      {[
        { l: "8%",  h: 22, w: 4, c: "#67e8f9" },
        { l: "20%", h: 30, w: 5, c: "#22d3ee" },
        { l: "32%", h: 18, w: 4, c: "#67e8f9" },
        { l: "55%", h: 26, w: 5, c: "#0e7490" },
        { l: "70%", h: 22, w: 4, c: "#22d3ee" },
        { l: "85%", h: 28, w: 5, c: "#67e8f9" },
      ].map((s, i) => (
        <div key={i} style={{
          position: "absolute", top: 0, left: s.l, width: `${s.w}%`, height: `${s.h}%`,
          background: `linear-gradient(180deg, #1e3a52 0%, ${s.c}88 60%, ${s.c} 100%)`,
          clipPath: "polygon(20% 0%, 80% 0%, 50% 100%)",
          filter: `drop-shadow(0 4px 4px ${s.c}66)`,
          animation: i % 2 === 0 ? `hb-pulse ${3 + i * 0.4}s ease-in-out infinite` : undefined,
        }} />
      ))}
      {/* Glowing geode in back wall */}
      <div style={{
        position: "absolute", top: "35%", left: "50%", transform: "translateX(-50%)",
        width: "22%", aspectRatio: "1.2 / 1",
      }}>
        <div style={{
          position: "absolute", inset: "10%",
          background: "radial-gradient(ellipse, #67e8f9 0%, #22d3ee 40%, #0e7490 100%)",
          borderRadius: "50%",
          filter: "blur(2px)",
          boxShadow: "0 0 24px #22d3ee, inset 0 0 12px rgba(255,255,255,0.3)",
          animation: "hb-pulse 4s ease-in-out infinite",
        }} />
      </div>
      {/* Stalagmites rising from floor */}
      {[
        { l: "5%",  h: 35, w: 7, c: "#67e8f9" },
        { l: "18%", h: 22, w: 5, c: "#22d3ee" },
        { l: "78%", h: 38, w: 8, c: "#67e8f9" },
        { l: "92%", h: 25, w: 6, c: "#22d3ee" },
      ].map((c, i) => (
        <div key={i} style={{
          position: "absolute", bottom: "8%", left: c.l, width: `${c.w}%`, height: `${c.h}%`,
          background: `linear-gradient(180deg, ${c.c} 0%, ${c.c}66 50%, #1e3a52 100%)`,
          clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
          filter: `drop-shadow(0 0 6px ${c.c}aa)`,
          animation: `hb-pulse ${2.5 + i * 0.3}s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      {/* Water drops */}
      {[
        { l: "25%", t: 0, d: 0 }, { l: "60%", t: 0, d: 1.5 },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: 0,
          width: 3, height: 6, borderRadius: "50% 50% 50% 50% / 30% 30% 70% 70%",
          background: "linear-gradient(180deg, #67e8f9 0%, #22d3ee 100%)",
          boxShadow: "0 0 4px #22d3ee",
          animation: `hb-driftY 3s ease-in ${p.d}s infinite reverse`,
        }} />
      ))}
    </>
  );
}

// Tier 5 — Royal Hall. King slime reigns. Ornate marble floor, gold throne,
// stained glass window, banners, polished and grand.
function ThroneRoom() {
  return (
    <>
      {/* Royal interior gradient */}
      <div style={{ position: "absolute", inset: 0,
        background: "linear-gradient(180deg, #4a1604 0%, #6e3d0a 35%, #92400e 75%, #2e1604 100%)" }} />
      {/* Stained glass window */}
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ position: "absolute", top: "5%", left: "30%", width: "40%", height: "45%" }}>
        <defs>
          <linearGradient id="rh-glass" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="40%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#7c2d12" />
          </linearGradient>
        </defs>
        <path d="M 10 60 L 10 18 Q 50 -3 90 18 L 90 60 Z" fill="url(#rh-glass)" stroke="#451a03" strokeWidth="1.5" opacity="0.9" />
        <line x1="50" y1="0" x2="50" y2="60" stroke="#451a03" strokeWidth="1.2" />
        <line x1="30" y1="18" x2="30" y2="60" stroke="#451a03" strokeWidth="0.8" />
        <line x1="70" y1="18" x2="70" y2="60" stroke="#451a03" strokeWidth="0.8" />
        <line x1="10" y1="40" x2="90" y2="40" stroke="#451a03" strokeWidth="0.8" />
        {/* Glass color blocks */}
        <rect x="12" y="20" width="16" height="18" fill="#dc2626" opacity="0.5" />
        <rect x="32" y="20" width="16" height="18" fill="#1d4ed8" opacity="0.5" />
        <rect x="52" y="20" width="16" height="18" fill="#16a34a" opacity="0.5" />
        <rect x="72" y="20" width="16" height="18" fill="#a855f7" opacity="0.5" />
      </svg>
      {/* Hanging banners */}
      {[{ l: "16%", c: "#dc2626" }, { r: "16%", c: "#1d4ed8" }].map((b, i) => (
        <div key={i} style={{ position: "absolute", top: 0, ...b, width: "10%", height: "45%",
          animation: `hb-sway ${3 + i * 0.3}s ease-in-out ${i * 0.2}s infinite`,
          transformOrigin: "top center" }}>
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(180deg, ${b.c} 0%, ${b.c}aa 90%, transparent 100%)`,
            clipPath: "polygon(0% 0%, 100% 0%, 100% 88%, 50% 100%, 0% 88%)",
            boxShadow: `0 4px 12px ${b.c}55`,
          }} />
          <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)",
            color: "#fbbf24", fontSize: 12, fontWeight: 900, textShadow: "0 0 4px #000" }}>★</div>
        </div>
      ))}
      {/* Pillars on sides */}
      {[{ l: "3%" }, { r: "3%" }].map((pos, i) => (
        <div key={i} style={{ position: "absolute", top: "5%", bottom: "12%", ...pos, width: "11%" }}>
          <div style={{ position: "absolute", top: "-2%", left: "-18%", right: "-18%", height: "7%",
            background: "linear-gradient(180deg, #fde68a 0%, #d97706 100%)",
            borderRadius: "3px" }} />
          <div style={{ position: "absolute", top: "5%", bottom: "5%", left: "10%", right: "10%",
            background: "linear-gradient(90deg, #78350f 0%, #fde68a 30%, #fef3c7 50%, #fde68a 70%, #78350f 100%)",
            boxShadow: "inset 0 0 8px rgba(0,0,0,0.5)" }} />
          <div style={{ position: "absolute", bottom: "-2%", left: "-18%", right: "-18%", height: "7%",
            background: "linear-gradient(0deg, #fde68a 0%, #d97706 100%)",
            borderRadius: "3px" }} />
        </div>
      ))}
      {/* Throne in back */}
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: "18%", left: "38%", width: "24%", height: "32%" }}>
        <defs>
          <linearGradient id="rh-throne" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#92400e" />
          </linearGradient>
        </defs>
        <path d="M 18 60 L 18 18 Q 25 5 50 5 Q 75 5 82 18 L 82 60 Z" fill="url(#rh-throne)" stroke="#fef3c7" strokeWidth="1.5" />
        <circle cx="30" cy="14" r="2.5" fill="#dc2626" />
        <circle cx="50" cy="8" r="3" fill="#1d4ed8" />
        <circle cx="70" cy="14" r="2.5" fill="#dc2626" />
      </svg>
      {/* Marble floor */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "18%",
        background: "linear-gradient(180deg, #44403c 0%, #1c1917 100%)",
        boxShadow: "inset 0 8px 12px rgba(0,0,0,0.4)" }} />
      {/* Red carpet */}
      <div style={{
        position: "absolute", bottom: 0, left: "32%", right: "32%", top: "65%",
        background: "linear-gradient(180deg, transparent 0%, #991b1b 25%, #7f1d1d 100%)",
        clipPath: "polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%)",
        boxShadow: "0 0 8px rgba(127,29,29,0.5)",
      }} />
      {/* Sparkles */}
      {[
        { l: "20%", t: "25%", d: 0 }, { l: "75%", t: "30%", d: 0.7 },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          color: "#fde68a", fontSize: 10, fontWeight: 900,
          textShadow: "0 0 8px #fbbf24",
          animation: `hb-twinkle 2s ease-in-out ${p.d}s infinite`,
        }}>✦</div>
      ))}
    </>
  );
}

// ─── PAID TIERS — premium, animated, signature focal points ──────────────────

function CelestialArena() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 50%, #1e0b4d 0%, #0d0526 80%, #050213 100%)" }} />
      {/* Distant nebula */}
      <div style={{ position: "absolute", top: "20%", left: "60%", width: "50%", height: "50%",
        background: "radial-gradient(ellipse, rgba(168,85,247,0.35) 0%, transparent 70%)", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", top: "30%", left: "0%", width: "45%", height: "40%",
        background: "radial-gradient(ellipse, rgba(236,72,153,0.25) 0%, transparent 70%)", filter: "blur(20px)" }} />
      {/* Stars at three depth layers */}
      <Stars count={50} color="#e0e7ff" />
      {/* Black hole / event horizon */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)",
        width: "30%", aspectRatio: "1",
      }}>
        {/* Accretion disk */}
        <div style={{
          position: "absolute", inset: "-20%",
          background: "conic-gradient(from 0deg, transparent 0deg, #c084fc 60deg, #e879f9 90deg, #fbbf24 130deg, #c084fc 180deg, transparent 220deg, #818cf8 280deg, transparent 360deg)",
          borderRadius: "50%",
          filter: "blur(6px)",
          animation: "hb-spin 15s linear infinite",
        }} />
        {/* Event horizon */}
        <div style={{
          position: "absolute", inset: "20%",
          background: "radial-gradient(circle, #000 50%, rgba(0,0,0,0.3) 100%)",
          borderRadius: "50%",
          boxShadow: "0 0 20px rgba(192,132,252,0.6)",
        }} />
      </div>
      {/* Ringed planet */}
      <div style={{ position: "absolute", top: "55%", right: "12%", width: "18%", aspectRatio: "1.6 / 1",
        animation: "hb-float 7s ease-in-out infinite" }}>
        <svg viewBox="0 0 100 60" style={{ width: "100%", height: "100%" }}>
          <defs>
            <radialGradient id="ca-planet" cx="0.35" cy="0.35">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="60%" stopColor="#c026d3" />
              <stop offset="100%" stopColor="#1e0b4d" />
            </radialGradient>
          </defs>
          <ellipse cx="50" cy="30" rx="35" ry="6" fill="none" stroke="#a78bfa" strokeWidth="2" opacity="0.8" />
          <circle cx="50" cy="30" r="16" fill="url(#ca-planet)" filter="drop-shadow(0 0 6px #c026d3)" />
          <ellipse cx="50" cy="30" rx="35" ry="6" fill="none" stroke="#c4b5fd" strokeWidth="0.8" />
        </svg>
      </div>
      {/* Aurora ribbon */}
      <div style={{
        position: "absolute", top: "60%", left: "-15%", right: "-15%", height: "20%",
        background: "linear-gradient(90deg, transparent 0%, #67e8f9 30%, #c4b5fd 50%, #f0abfc 70%, transparent 100%)",
        filter: "blur(14px)", opacity: 0.6,
        animation: "hb-aurora 9s ease-in-out infinite",
      }} />
    </>
  );
}

function MysticGarden() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 100%, #115e59 0%, #064e3b 50%, #022c22 100%)" }} />
      {/* Mist layers */}
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 80%, rgba(94,234,212,0.25) 0%, transparent 50%)" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%",
        background: "linear-gradient(0deg, rgba(94,234,212,0.2) 0%, transparent 100%)", filter: "blur(8px)" }} />
      {/* Tree of life — signature element */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", bottom: "10%", left: "30%", width: "40%", height: "70%" }}>
        <defs>
          <linearGradient id="mg-trunk" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
          <radialGradient id="mg-canopy" cx="0.5" cy="0.5">
            <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#2dd4bf" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#115e59" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Canopy glow */}
        <ellipse cx="50" cy="35" rx="48" ry="32" fill="url(#mg-canopy)" />
        {/* Trunk */}
        <path d="M 45 100 L 47 60 Q 35 50 38 30 M 55 100 L 53 60 Q 65 50 62 30 M 50 100 L 50 35"
          stroke="url(#mg-trunk)" strokeWidth="3" fill="none" strokeLinecap="round" filter="drop-shadow(0 0 4px #5eead4)" />
        {/* Glowing fruits */}
        {[
          { x: 38, y: 25 }, { x: 50, y: 18 }, { x: 62, y: 25 },
          { x: 30, y: 40 }, { x: 70, y: 40 }, { x: 50, y: 45 },
        ].map((f, i) => (
          <circle key={i} cx={f.x} cy={f.y} r="2" fill="#5eead4" filter="drop-shadow(0 0 4px #2dd4bf)" />
        ))}
      </svg>
      {/* Ring of mushrooms */}
      {[
        { l: "8%",  s: 18, c: "#2dd4bf", d: 0 },
        { l: "82%", s: 22, c: "#5eead4", d: 0.4 },
      ].map((m, i) => (
        <div key={i} style={{ position: "absolute", bottom: "12%", left: m.l, width: `${m.s}%`, height: `${m.s * 1.5}%` }}>
          <div style={{
            position: "absolute", bottom: 0, left: "35%", width: "30%", height: "55%",
            background: "linear-gradient(180deg, #fef3c7 0%, #fcd34d 100%)",
            borderRadius: "20% 20% 4px 4px",
          }} />
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "55%",
            background: `radial-gradient(ellipse at 50% 80%, ${m.c} 0%, ${m.c}cc 50%, ${m.c}66 100%)`,
            borderRadius: "50% 50% 30% 30%",
            boxShadow: `0 0 18px ${m.c}, inset 0 -4px 8px rgba(0,0,0,0.2)`,
            animation: `hb-pulse 3s ease-in-out ${m.d}s infinite`,
          }} />
        </div>
      ))}
      {/* Floating spores */}
      {[
        { l: "18%", t: "30%", d: 0 }, { l: "30%", t: "55%", d: 1 },
        { l: "60%", t: "40%", d: 2 }, { l: "80%", t: "50%", d: 1.5 },
        { l: "45%", t: "25%", d: 2.7 },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          width: 6, height: 6, borderRadius: "50%",
          background: "#5eead4",
          boxShadow: "0 0 10px #2dd4bf",
          animation: `hb-driftY 5s ease-out ${p.d}s infinite`,
        }} />
      ))}
    </>
  );
}

function AstralRealm() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 50%, #581c87 0%, #1e0b4d 60%, #0d0420 100%)" }} />
      {/* Spiral galaxy backdrop */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        width: "120%", aspectRatio: "1",
        background: "conic-gradient(from 0deg, transparent 0deg, rgba(232,121,249,0.4) 60deg, rgba(192,132,252,0.5) 130deg, transparent 200deg, rgba(244,114,182,0.35) 280deg, rgba(129,140,248,0.3) 340deg, transparent 360deg)",
        borderRadius: "50%",
        filter: "blur(14px)",
        animation: "hb-spinSlow 40s linear infinite",
      }} />
      <Stars count={60} color="#f0abfc" />
      {/* Dimensional rift — signature */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)",
        width: "32%", aspectRatio: "0.7 / 1",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at center, #fde047 0%, #e879f9 30%, #4c1d95 70%, transparent 100%)",
          borderRadius: "50%",
          filter: "blur(8px)",
          animation: "hb-pulse 3s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", inset: "20%",
          background: "linear-gradient(180deg, transparent 0%, #fef3c7 50%, transparent 100%)",
          clipPath: "polygon(50% 0%, 60% 50%, 50% 100%, 40% 50%)",
          filter: "blur(2px)",
          animation: "hb-pulse 2s ease-in-out infinite",
        }} />
      </div>
      {/* Twin orbs orbiting */}
      <div style={{ position: "absolute", top: "50%", left: "20%",
        width: 14, height: 14, borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, #fbbf24 0%, #f97316 100%)",
        boxShadow: "0 0 16px #fbbf24",
        animation: "hb-orbit 10s linear infinite",
      }} />
      <div style={{ position: "absolute", top: "55%", right: "20%",
        width: 12, height: 12, borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, #f0abfc 0%, #c026d3 100%)",
        boxShadow: "0 0 14px #c026d3",
        animation: "hb-orbit 12s linear reverse infinite",
      }} />
      {/* Floating geometric platforms */}
      <div style={{ position: "absolute", top: "70%", left: "10%", width: "12%", height: "3%",
        background: "linear-gradient(180deg, #c4b5fd 0%, #6d28d9 100%)",
        transform: "perspective(40px) rotateX(50deg)",
        boxShadow: "0 4px 8px rgba(109,40,217,0.5)",
      }} />
      <div style={{ position: "absolute", top: "75%", right: "8%", width: "14%", height: "3%",
        background: "linear-gradient(180deg, #f0abfc 0%, #a21caf 100%)",
        transform: "perspective(40px) rotateX(50deg)",
        boxShadow: "0 4px 8px rgba(162,28,175,0.5)",
      }} />
    </>
  );
}

function CosmicThrone() {
  return (
    <>
      {/* Heavenly gradient */}
      <div style={{ position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 50% 90%, #fde68a 0%, #fbbf24 15%, #b45309 50%, #4a1604 80%, #1f0a04 100%)" }} />
      {/* Cathedral pillars receding */}
      {[{ l: "8%" }, { r: "8%" }, { l: "28%" }, { r: "28%" }].map((pos, i) => {
        const isInner = (pos as { l?: string }).l?.startsWith("28") || (pos as { r?: string }).r?.startsWith("28");
        return (
          <div key={i} style={{
            position: "absolute", top: 0, bottom: "30%", ...pos,
            width: isInner ? "5%" : "7%",
            opacity: isInner ? 0.5 : 1,
            background: "linear-gradient(90deg, #4a1604 0%, #fbbf24 50%, #4a1604 100%)",
            filter: isInner ? "blur(2px)" : "none",
            boxShadow: "inset 0 0 6px rgba(0,0,0,0.5)",
          }} />
        );
      })}
      {/* Divine light rays from above */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
        const angle = -50 + i * 12.5;
        return (
          <div key={i} style={{
            position: "absolute", top: 0, left: "50%",
            width: "3.5%", height: "120%",
            background: "linear-gradient(180deg, rgba(254,240,138,0.7) 0%, rgba(251,191,36,0.3) 50%, transparent 90%)",
            transform: `translateX(-50%) rotate(${angle}deg)`,
            transformOrigin: "top center",
            filter: "blur(3px)",
            animation: `hb-rays ${2.5 + i * 0.15}s ease-in-out ${i * 0.15}s infinite`,
          }} />
        );
      })}
      {/* Floating crown — signature */}
      <div style={{
        position: "absolute", top: "12%", left: "50%", transform: "translateX(-50%)",
        width: "28%", height: "20%",
        animation: "hb-float 5s ease-in-out infinite",
        filter: "drop-shadow(0 0 16px #fbbf24) drop-shadow(0 4px 8px rgba(0,0,0,0.5))",
      }}>
        <svg viewBox="0 0 100 50" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="ct-crown" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="50%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
          </defs>
          <path d="M 5 42 L 5 22 L 18 18 L 25 32 L 35 8 L 50 14 L 65 8 L 75 32 L 82 18 L 95 22 L 95 42 Z"
            fill="url(#ct-crown)" stroke="#fef3c7" strokeWidth="1" />
          <rect x="5" y="40" width="90" height="6" fill="#fbbf24" />
          <circle cx="18" cy="22" r="3" fill="#dc2626" />
          <circle cx="35" cy="13" r="4" fill="#10b981" />
          <circle cx="50" cy="20" r="5" fill="#a78bfa" />
          <circle cx="65" cy="13" r="4" fill="#10b981" />
          <circle cx="82" cy="22" r="3" fill="#dc2626" />
        </svg>
      </div>
      {/* Gold particle storm */}
      {Array.from({ length: 18 }).map((_, i) => {
        const left = (i * 5.5 + 3) % 100;
        const delay = (i * 0.3) % 5;
        return (
          <div key={i} style={{
            position: "absolute", bottom: 0, left: `${left}%`,
            width: 3, height: 3, borderRadius: "50%",
            background: "#fef3c7",
            boxShadow: "0 0 6px #fbbf24",
            animation: `hb-driftY 5s ease-out ${delay}s infinite`,
          }} />
        );
      })}
    </>
  );
}

function EternalSanctuary() {
  return (
    <>
      {/* Holographic shimmer base */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 20%, #06b6d4 40%, #22c55e 60%, #fbbf24 80%, #ec4899 100%)",
        backgroundSize: "300% 300%",
        animation: "hb-shimmer 12s linear infinite",
        opacity: 0.85,
      }} />
      {/* Dark veil for readability */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,2,32,0.5)" }} />
      {/* Concentric reality rings */}
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: `${i * 22}%`, aspectRatio: "1",
          borderRadius: "50%",
          border: `1.5px solid rgba(255,255,255,${0.6 - i * 0.1})`,
          boxShadow: `0 0 12px rgba(244,114,182,${0.4 - i * 0.06}) inset, 0 0 12px rgba(244,114,182,${0.4 - i * 0.06})`,
          animation: `hb-pulse ${3 + i * 0.5}s ease-in-out ${i * 0.3}s infinite`,
        }} />
      ))}
      {/* Reality fracture glitch lines */}
      <div style={{
        position: "absolute", top: "30%", left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg, transparent, #fff, #f0abfc, #67e8f9, transparent)",
        boxShadow: "0 0 6px #fff",
        animation: "hb-glitchH 0.4s ease-in-out infinite",
        opacity: 0.6,
      }} />
      <div style={{
        position: "absolute", top: "65%", left: 0, right: 0, height: "1px",
        background: "linear-gradient(90deg, transparent, #fbbf24, #fff, transparent)",
        boxShadow: "0 0 6px #fff",
        animation: "hb-glitchH 0.6s ease-in-out 0.2s infinite",
        opacity: 0.5,
      }} />
      {/* Mythic glyphs orbiting */}
      {[
        { l: "12%", t: "18%", g: "✧", d: 0,   s: 16 },
        { l: "82%", t: "22%", g: "✦", d: 0.7, s: 14 },
        { l: "18%", t: "72%", g: "✺", d: 1.3, s: 18 },
        { l: "78%", t: "68%", g: "❋", d: 2,   s: 16 },
        { l: "50%", t: "12%", g: "❉", d: 1.5, s: 20 },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          color: "#fff", fontSize: p.s, fontWeight: 900,
          textShadow: "0 0 10px #fff, 0 0 20px #f0abfc",
          animation: `hb-twinkle 2.5s ease-in-out ${p.d}s infinite, hb-spin 25s linear infinite`,
        }}>{p.g}</div>
      ))}
      <Stars count={28} color="#fef3c7" />
    </>
  );
}
