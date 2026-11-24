"use client";

import { useEffect, useState } from "react";

// Creator / thread contest referral leaderboard — a dedicated view for tracking
// qualified referrals per creator during the contest window. Separate from the
// in-app tug recruiter prize. Pass ?since=ISO&until=ISO to scope the window;
// defaults to the backend's CREATOR_CONTEST window env.

type Row = { rank: number; name: string; qualifiedReferrals: number };

const T = {
  bg: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)",
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.68)",
  inkSoft: "rgba(34,16,79,0.66)",
  surface: "#ffffff",
  hairline: "rgba(76,29,149,0.14)",
  gold: "#b45309",
  accent: "#6d28d9",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
};

export default function CreatorContest() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ updatedAt: string | null; rule?: string; window?: { since: string | null; until: string | null } }>({ updatedAt: null });

  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    let alive = true;
    const load = () => fetch(`/api/referrals/leaderboard${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) { setRows(d.leaderboard || []); setMeta({ updatedAt: d.updatedAt, rule: d.rule, window: d.window }); } })
      .catch(() => {});
    load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000) /* a tab nobody is looking at does not need fresh data */;
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
            Every creator ranked by referrals who <strong style={{ color: T.ink }}>{meta.rule || "verified"}</strong>.
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
          A referral counts once the player {meta.rule || "verified"}. Updated every minute.
          {meta.updatedAt && <> · {new Date(meta.updatedAt).toLocaleTimeString()}</>}
        </p>
      </div>
    </main>
  );
}
