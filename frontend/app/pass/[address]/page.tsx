// ─── /pass/[address] · the public player passport ────────────────────────────
// Every verified player gets a shareable public page: identity (username +
// GamePass status), rank, best scores, badges, pet in its habitat, and their
// lifetime UBI contribution. Server-rendered so link crawlers see real data,
// with a per-player OG image (opengraph-image.tsx beside this file). Every
// outbound CTA carries ?ref={address} — the passport is the referral engine.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPassport, resolvePassHandle } from "@/lib/passport";
import PassportActions from "@/components/PassportActions";
import PassTopBar from "@/components/PassTopBar";

export const revalidate = 60;

const T = {
  bg: "linear-gradient(180deg, #f3eeff 0%, #e6dcff 100%)",
  ink: "#22104f",
  inkDim: "rgba(34,16,79,0.68)",
  inkSoft: "rgba(34,16,79,0.66)",
  hairline: "rgba(76,29,149,0.14)",
  surface: "#ffffff",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
const GOLD = "#b45309";

function displayName(p: { username: string | null; address: string }): string {
  return p.username ? `@${p.username.replace(/^@/, "")}` : `${p.address.slice(0, 6)}…${p.address.slice(-4)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address: handle } = await params;
  const resolved = await resolvePassHandle(handle);
  const p = resolved ? await getPassport(resolved) : null;
  if (!p) return { title: "Player Passport" };
  const name = displayName(p);
  const title = `${name} · Game Arena Passport`;
  const description = `${p.rank ? `Ranked #${p.rank} · ` : ""}LV ${p.level} · ${p.gamesPlayed} games played · ${
    p.badges.gold + p.badges.silver + p.badges.bronze
  } podium badges. Quick games that make you sharper, on Celo — think you can beat them?`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PassportPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: handle } = await params;
  const resolved = await resolvePassHandle(handle);
  const p = resolved ? await getPassport(resolved) : null;
  if (!p) notFound();

  const name = displayName(p);
  const totalBadges = p.badges.gold + p.badges.silver + p.badges.bronze;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: T.body }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "14px 16px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
        <PassTopBar />

        {/* identity hero · pet standing in its habitat */}
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", border: `1px solid ${T.hairline}`, background: p.habitat?.gradient || T.surface }}>
          {p.habitat?.bgImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.habitat.bgImage} alt={p.habitat.name} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.92) 100%)" }} />
          <div style={{ position: "relative", zIndex: 1, padding: "26px 18px 18px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.pet.src} alt={p.pet.name} style={{ width: 96, height: 96, objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.5))" }} />
            <div style={{ fontFamily: T.display, fontSize: 26, letterSpacing: "0.03em", marginTop: 8 }}>
              {name}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap", justifyContent: "center" }}>
              {p.verified && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "#15803d", background: "rgba(34,197,94,0.18)", border: "1px solid rgba(21,128,61,0.7)", borderRadius: 999, padding: "3px 9px", letterSpacing: "0.08em" }}>
                  ✓ VERIFIED HUMAN
                </span>
              )}
              {p.minted && !p.verified && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: T.ink, background: "#ede9fe", border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "4px 10px", letterSpacing: "0.06em" }}>
                  🎮 GAMEPASS
                </span>
              )}
              <span style={{ fontSize: 9.5, fontWeight: 800, color: T.ink, background: "#ede9fe", border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "4px 10px", letterSpacing: "0.06em" }}>
                LV {p.level}
              </span>
              {p.habitat && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: T.ink, background: "#ede9fe", border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "4px 10px", letterSpacing: "0.06em" }}>
                  🏠 {p.habitat.name.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* headline stats · rank leads (the boast) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Stat label="ALL-TIME RANK" value={p.rank ? `#${p.rank}` : "—"} tone={GOLD} />
          <Stat label="GAMES PLAYED" value={String(p.gamesPlayed)} />
          <Stat label="DAY STREAK" value={p.streak > 0 ? `🔥 ${p.streak}` : "0"} />
        </div>

        {/* best scores */}
        <Section title="BEST SCORES">
          {/* every game a player can rank in; one not played yet shows a dash, not a zero */}
          {([["🧱", "Stack Tower", p.bestStack], ["🔤", "Word Ladder", p.bestLadder], ["🧠", "Simon Memory", p.bestSimon], ["🎵", "Rhythm Rush", p.bestRhythm], ["🛞", "Street Strike", p.bestStrike], ["💡", "UP NEPA 3D", p.bestNepa3d], ["🤖", "Challenge AI", p.bestChallenge]] as const).map(([icon, label, n]) => (
            <Row key={label} icon={icon} label={label} value={n > 0 ? n.toLocaleString() : "–"} />
          ))}
        </Section>

        {/* badges */}
        {totalBadges > 0 && (
          <Section title="SEASON PODIUMS">
            <div style={{ display: "flex", gap: 8, padding: "10px 14px" }}>
              {p.badges.gold > 0 && <Medal emoji="🥇" count={p.badges.gold} />}
              {p.badges.silver > 0 && <Medal emoji="🥈" count={p.badges.silver} />}
              {p.badges.bronze > 0 && <Medal emoji="🥉" count={p.badges.bronze} />}
            </div>
          </Section>
        )}

        {/* social impact · lifetime UBI routed by this player's G$ spending */}
        {p.ubiTotalG > 0 && (
          <Section title="SOCIAL IMPACT">
            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(34,197,94,0.14)", border: "1px solid rgba(134,239,172,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>💚</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{p.ubiTotalG} G$ to universal basic income</div>
                <div style={{ fontSize: 10.5, color: T.inkSoft, fontWeight: 600, marginTop: 2 }}>
                  20% of every G$ this player spends supports {p.collective.emoji} {p.collective.name}
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* share (own passport) / challenge CTA (visitor) · client component */}
        <PassportActions address={p.address} name={name} refCode={p.username} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 14, padding: "12px 8px", textAlign: "center" }}>
      <div style={{ fontFamily: T.display, fontSize: 20, color: tone || T.ink, letterSpacing: "0.02em" }}>{value}</div>
      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.12em", color: T.inkSoft, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: "0 4px 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim }}>{title}</div>
      <div className="pass-rows" style={{ background: T.surface, border: `1px solid ${T.hairline}`, borderRadius: 14, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(167,139,250,0.14)", border: "1px solid rgba(167,139,250,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: T.display, fontSize: 16, color: GOLD }}>{value}</div>
    </div>
  );
}

function Medal({ emoji, count }: { emoji: string; count: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ede9fe", color: T.ink, border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "7px 13px", fontSize: 14 }}>
      {emoji} <span style={{ fontFamily: T.display, fontSize: 15 }}>{count}</span>
    </span>
  );
}
