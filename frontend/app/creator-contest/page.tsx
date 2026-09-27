"use client";

import { useEffect, useState } from "react";

// Creator / thread contest referral leaderboard — a dedicated view for tracking
// qualified referrals per creator during the contest window. Separate from the
// in-app tug recruiter prize. Pass ?since=ISO&until=ISO to scope the window;
// defaults to the backend's CREATOR_CONTEST window env.

type Row = { rank: number; name: string; qualifiedReferrals: number };

const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 42%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.82)",
  inkSoft: "rgba(220,210,255,0.62)",
  surface: "rgba(40,18,100,0.5)",
  hairline: "rgba(255,255,255,0.09)",
  gold: "#fde68a",
  accent: "#a78bfa",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
};

export default function CreatorContest() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: string | null; window?: { since: string | null; until: string | null } }>({ updatedAt: null });

  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    let alive = true;
    const load = () => fetch(`/api/referrals/leaderboard${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setRows(d.leaderboard || []); setMeta({ updatedAt: d.updatedAt, window: d.window }); } })
      .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

  return (
    <main style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.body, padding: "20px 16px 48px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", color: T.accent }}>CREATOR CONTEST</div>
          <h1 style={{ fontFamily: T.display, fontSize: 26, margin: "3px 0 0" }}>Qualified referrals</h1>
          <p style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.5, marginTop: 6, maxWidth: 520 }}>
            Every creator ranked by referrals who <strong style={{ color: T.ink }}>verified and played the qualifying games</strong>.
            {meta.window?.since && <> Window: {fmtDate(meta.window.since)}{meta.window.until ? ` – ${fmtDate(meta.window.until)}` : ""}.</>}
          </p>
        </div>

        <div style={{ borderRadius: 16, background: T.surface, border: `1px solid ${T.hairline}`, overflow: "hidden" }}>
          {rows === null && <div style={{ padding: 20, color: T.inkSoft, fontSize: 13 }}>Loading…</div>}
          {rows !== null && rows.length === 0 && (
            <div style={{ padding: 20, color: T.inkSoft, fontSize: 13 }}>No qualified referrals in this window yet.</div>
          )}
          {rows?.map((r) => (
            <div key={r.rank} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
              borderBottom: `1px solid ${T.hairline}`,
              background: r.rank <= 3 ? "rgba(251,191,36,0.06)" : "transparent",
            }}>
              <span style={{ fontFamily: T.display, fontSize: 15, width: 26, color: r.rank <= 3 ? T.gold : T.inkSoft }}>{r.rank}</span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: T.body, fontSize: 14, fontWeight: 700, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
              </span>
              <span style={{ fontFamily: T.display, fontSize: 17, color: T.ink, fontVariantNumeric: "tabular-nums" }}>{r.qualifiedReferrals}</span>
            </div>
          ))}
        </div>

        <p style={{ fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, textAlign: "center" }}>
          A referral counts once the player verifies and plays the qualifying games. Updated every minute.
          {meta.updatedAt && <> · {new Date(meta.updatedAt).toLocaleTimeString()}</>}
        </p>
      </div>
    </main>
  );
}
