"use client";

// ─── /animtest · animation diagnostics ───────────────────────────────────────
// Three boxes, three animation engines. Open on the problem device and read
// the verdicts — tells us in one look which layer kills animations there:
//   CSS  = declarative keyframes (what the arena uses)
//   WAAPI = element.animate() (compositor-driven, same pipeline as CSS)
//   rAF  = raw JS per-frame style writes (ignores OS animation scales)
// OS-level "remove animations" → CSS ✗, WAAPI ✗, rAF ✓
// CSS delivery/parsing issue    → CSS ✗, WAAPI ✓, rAF ✓
// All ✓ but the arena is static → problem is arena-specific, not the device.

import { useEffect, useRef, useState } from "react";


function Box({ label, ok, children }: { label: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.06)" }}>
      <div style={{ width: 70, height: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>{children}</div>
      <div>
        <div style={{ fontWeight: 900, fontSize: 16 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: ok === null ? "#aaa" : ok ? "#4ade80" : "#f87171" }}>
          {ok === null ? "testing…" : ok ? "✓ WORKS" : "✗ DEAD"}
        </div>
      </div>
    </div>
  );
}

export default function AnimTestPage() {
  const [cssOk, setCssOk] = useState<boolean | null>(null);
  const [waapiOk, setWaapiOk] = useState<boolean | null>(null);
  const [rafOk, setRafOk] = useState<boolean | null>(null);
  const [info, setInfo] = useState("");
  const cssRef = useRef<HTMLDivElement>(null);
  const waapiRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    setInfo(`${navigator.userAgent}\n\nprefers-reduced-motion: ${reduced ? "REDUCE (motion disabled in OS!)" : "no-preference (normal)"}`);

    // CSS test: sample transform twice mid-animation — did it move?
    const samples: string[] = [];
    const t1 = setTimeout(() => { if (cssRef.current) samples.push(getComputedStyle(cssRef.current).transform); }, 250);
    const t2 = setTimeout(() => {
      if (cssRef.current) samples.push(getComputedStyle(cssRef.current).transform);
      setCssOk(samples.length === 2 && samples[0] !== samples[1]);
    }, 600);

    // WAAPI test
    let anim: Animation | undefined;
    try {
      anim = waapiRef.current?.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-30px)" }, { transform: "translateY(0)" }],
        { duration: 700, iterations: Infinity },
      );
      const w: string[] = [];
      setTimeout(() => { if (waapiRef.current) w.push(getComputedStyle(waapiRef.current).transform); }, 300);
      setTimeout(() => {
        if (waapiRef.current) w.push(getComputedStyle(waapiRef.current).transform);
        setWaapiOk(w.length === 2 && w[0] !== w[1]);
      }, 650);
    } catch { setWaapiOk(false); }

    // rAF test: manual per-frame writes — immune to OS animation scales.
    let frames = 0; let rafId = 0; const start = performance.now();
    const tick = (now: number) => {
      frames++;
      if (rafRef.current) {
        const y = Math.sin((now - start) / 150) * -15 - 15;
        rafRef.current.style.transform = `translateY(${y}px)`;
      }
      if (now - start < 700) rafId = requestAnimationFrame(tick);
      else setRafOk(frames > 10);
    };
    rafId = requestAnimationFrame(tick);

    return () => { clearTimeout(t1); clearTimeout(t2); anim?.cancel(); cancelAnimationFrame(rafId); };
  }, []);

  const fist = { width: 48, height: 48, borderRadius: 10, background: "linear-gradient(160deg,#fbbf24,#f59e0b)" };

  return (
    <div style={{ minHeight: "100dvh", background: "#150838", color: "#fff", padding: 20, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 900 }}>🔬 Animation Diagnostics</h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>Screenshot this whole screen after ~2 seconds and send it.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Box label="CSS keyframes" ok={cssOk}>
          <div ref={cssRef} style={{ ...fist, animation: "animtestPump 0.7s ease-in-out infinite" }} />
        </Box>
        <Box label="WAAPI (element.animate)" ok={waapiOk}>
          <div ref={waapiRef} style={fist} />
        </Box>
        <Box label="JS rAF (manual frames)" ok={rafOk}>
          <div ref={rafRef} style={fist} />
        </Box>
      </div>
      <pre style={{ marginTop: 18, fontSize: 10.5, whiteSpace: "pre-wrap", opacity: 0.75, lineHeight: 1.5 }}>{info}</pre>
    </div>
  );
}
