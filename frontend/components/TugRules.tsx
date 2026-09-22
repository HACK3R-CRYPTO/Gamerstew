"use client";

import { useState } from "react";

// ─── The rules, in the product ──────────────────────────────────────────────
// Collapsed by default and open on tap. Rules are reference material: a player
// mid-event wants one instruction, but a player deciding whether to join wants
// the whole thing — and if it is not in the app they will ask in Telegram, or
// worse, assume.
//
// The wording here is checked against what the code actually does. Two earlier
// lines were not: the screens promised "pick your side" (there is no picking)
// and "friends join your side" (before recruits inherited a team, they did not).
// Anything claimed below is enforced in games-backend/lib/tugEvent.js.

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.76)",
  inkSoft: "rgba(220,210,255,0.45)",
  surface: "rgba(40,18,100,0.5)",
  hairline: "rgba(255,255,255,0.09)",
  accent: "#a78bfa",
  gold: "#fde68a",
  red: "#dc2626",
  blue: "#67e8f9",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export interface TugRulesProps {
  prizeTotalG: number;
  bountySlots: number;
  bountyAmountG: number;
  dailyPullCap: number;
  qualifyGames: number;
  pointsPerHuman?: number;
  defaultOpen?: boolean;
}

export default function TugRules({
  prizeTotalG, bountySlots, bountyAmountG, dailyPullCap, qualifyGames,
  pointsPerHuman = 10, defaultOpen = false,
}: TugRulesProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section style={{ borderRadius: 16, background: T.surface, border: `1px solid ${T.hairline}`, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, padding: "13px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 15 }}>📖</span>
          <span style={{ fontFamily: T.display, fontSize: 15, color: T.ink }}>How it works</span>
        </span>
        <span style={{
          fontFamily: T.body, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em",
          color: T.accent, whiteSpace: "nowrap",
        }}>
          {open ? "HIDE" : "FULL RULES"}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 15px", display: "flex", flexDirection: "column", gap: 15 }}>
          <Rule n="1" title="Verify once">
            <p style={p}>
              A 30-second face check proves you&apos;re a real person. It also decides your side.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
              <SideRow
                label="Came from a friend&apos;s link"
                value="You join THEIR team"
                tint="rgba(34,197,94,0.14)"
                border="rgba(134,239,172,0.4)"
              />
              <SideRow
                label="Came on your own"
                value="The system draws you Red or Blue"
                tint="rgba(167,139,250,0.13)"
                border="rgba(167,139,250,0.38)"
              />
            </div>
            <p style={{ ...p, marginTop: 9, color: T.inkSoft }}>
              You can&apos;t choose your own side, and nobody can move you off it. That&apos;s
              what stops one person stacking a team with spare wallets.
            </p>
          </Rule>

          <Rule n="2" title={`Play ${qualifyGames} games to start pulling`}>
            <p style={p}>
              Stack Tower, Simon Memory or Rhythm Rush. After {qualifyGames}, you count.
            </p>
          </Rule>

          <Rule n="3" title="What moves the rope">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
              <PointRow what="Each verified human on your side" pts={`${pointsPerHuman} pts`} strong />
              <PointRow what="Your best score each day, per game" pts="points" />
              <PointRow what={`Full rate up to ${dailyPullCap} a day`} pts="then slower" muted />
            </div>
            <p style={{ ...p, marginTop: 10 }}>
              Past {dailyPullCap} a day the points keep coming but slow down, so a
              huge run always beats a small one and nobody can play their way to
              the top alone. In practice the best day anyone has managed is worth
              about {pointsPerHuman - 1}, against {pointsPerHuman} for bringing one person.{" "}
              <strong style={{ color: T.ink }}>Recruiting still beats grinding.</strong>
            </p>
            <p style={{ ...p, marginTop: 7 }}>
              <strong style={{ color: T.ink }}>Quitting earns nothing.</strong> Points come from
              how well you play, not how many times you press start — only your
              best run each day counts, so restarting to farm does not work.
            </p>
            <p style={{ ...p, marginTop: 7, color: T.inkSoft }}>
              Play as much as you like, and play as well as you like. There is no
              hard ceiling, only a slower rate past {dailyPullCap}. It resets every
              day, so it isn&apos;t {dailyPullCap} for the whole week.
            </p>
          </Rule>

          <Rule n="4" title="Anyone you bring joins your side">
            <p style={p}>
              Share your link. When they verify and play, they pull for your team — not a random one.
              That&apos;s how you build a side you didn&apos;t pick.
            </p>
          </Rule>

          <Rule n="5" title={`${bountyAmountG.toLocaleString()} G$ guaranteed, first come`}>
            <p style={p}>
              This is a <strong style={{ color: T.ink }}>race, not a contest</strong>. There are{" "}
              <strong style={{ color: T.gold }}>{bountySlots}</strong> slots. You claim one by
              verifying and playing, and each is worth{" "}
              <strong style={{ color: T.gold }}>{bountyAmountG.toLocaleString()} G$</strong>.
            </p>
            <p style={{ ...p, marginTop: 7 }}>
              Your team doesn&apos;t matter here. Your score doesn&apos;t matter here. Only how
              early you show up. Once the {bountySlots}{" "}
              are gone, they&apos;re gone.
            </p>
            <p style={{ ...p, marginTop: 7 }}>
              <strong style={{ color: T.ink }}>You keep it even if your side loses the rope.</strong>{" "}
              These are two separate prizes.
            </p>
          </Rule>

          <Rule n="6" title="Winning the rope">
            <p style={p}>
              The remaining {(prizeTotalG - bountySlots * bountyAmountG).toLocaleString()}{" "}
              G$ splits between both sides — more to the winners, but the losing side is paid too, by how much
              each person pulled. There&apos;s a cap per person so no one takes it all.
            </p>
            <p style={{ ...p, marginTop: 7, color: T.inkSoft }}>
              Two scoreboards: the rope runs all seven days, and{" "}
              <strong style={{ color: T.ink }}>Today</strong>{" "}
              resets at midnight — so a team that&apos;s behind can still win today.
            </p>
          </Rule>
        </div>
      )}
    </section>
  );
}

const p: React.CSSProperties = {
  fontFamily: T.body, fontSize: 12.5, color: T.inkDim, lineHeight: 1.5, margin: 0, fontWeight: 500,
};

function Rule({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11 }}>
      <div style={{
        width: 22, height: 22, flexShrink: 0, borderRadius: 7, marginTop: 1,
        background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.display, fontSize: 11, color: T.accent,
      }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.display, fontSize: 14.5, color: T.ink, marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function SideRow({ label, value, tint, border }: { label: string; value: string; tint: string; border: string }) {
  return (
    <div style={{ padding: "8px 11px", borderRadius: 11, background: tint, border: `1px solid ${border}` }}>
      <div style={{ fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: T.inkSoft, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function PointRow({ what, pts, strong, muted }: { what: string; pts: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontFamily: T.body, fontSize: 12.5, color: muted ? T.inkSoft : T.inkDim, fontWeight: 600 }}>{what}</span>
      <span style={{
        fontFamily: T.display, fontSize: strong ? 15 : 13,
        color: strong ? T.ink : muted ? T.inkSoft : T.inkDim, whiteSpace: "nowrap",
      }}>{pts}</span>
    </div>
  );
}
