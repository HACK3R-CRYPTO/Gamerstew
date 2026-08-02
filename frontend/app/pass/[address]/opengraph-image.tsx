// ─── Per-player OG image · 1200×630 ─────────────────────────────────────────
// The social preview IS the acquisition asset: when a passport link lands in a
// group chat, this card is what sells the tap. One boast (rank), identity
// (name + pet), one CTA line. All critical content sits ≥90px from every edge
// (platform safe-zone), single message, big type.

import { ImageResponse } from "next/og";
import { getPassport } from "@/lib/passport";

export const alt = "Game Arena player passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASSET_BASE = "https://gamearenahq.xyz";

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const p = await getPassport(address).catch(() => null);

  const name = p ? (p.username ? `@${p.username.replace(/^@/, "")}` : `${p.address.slice(0, 6)}…${p.address.slice(-4)}`) : "Player";
  const totalBadges = p ? p.badges.gold + p.badges.silver + p.badges.bronze : 0;

  // Pet art fetched as bytes so satori can embed it (remote URLs are flaky
  // across crawlers' timeouts; bytes are deterministic).
  let petData: ArrayBuffer | null = null;
  try {
    const res = await fetch(`${ASSET_BASE}${p?.pet.src || "/pets/stage-1-egg.png"}`);
    if (res.ok) petData = await res.arrayBuffer();
  } catch {}

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 55%, #0a0226 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
          padding: "90px 96px",
          position: "relative",
        }}
      >
        {/* left · identity + boast */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 800 }}>{name}</div>
            {p?.minted && (
              <div style={{ display: "flex", fontSize: 18, fontWeight: 800, color: "#86efac", background: "rgba(34,197,94,0.2)", border: "2px solid rgba(134,239,172,0.5)", borderRadius: 999, padding: "6px 16px" }}>
                VERIFIED
              </div>
            )}
          </div>

          {p?.rank ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 18 }}>
              <div style={{ display: "flex", fontSize: 110, fontWeight: 800, color: "#fbbf24" }}>#{p.rank}</div>
              <div style={{ display: "flex", fontSize: 28, color: "rgba(220,210,255,0.75)", fontWeight: 700 }}>all-time rank</div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 54, fontWeight: 800, color: "#fbbf24", marginTop: 18 }}>Game Arena player</div>
          )}

          <div style={{ display: "flex", gap: 26, marginTop: 18, fontSize: 26, color: "rgba(220,210,255,0.85)", fontWeight: 700 }}>
            <div style={{ display: "flex" }}>LV {p?.level ?? 1}</div>
            <div style={{ display: "flex" }}>·</div>
            <div style={{ display: "flex" }}>{p?.gamesPlayed ?? 0} games</div>
            {totalBadges > 0 && (
              <>
                <div style={{ display: "flex" }}>·</div>
                <div style={{ display: "flex" }}>🏅 {totalBadges} podiums</div>
              </>
            )}
          </div>

          <div style={{ display: "flex", marginTop: 34, fontSize: 24, fontWeight: 800, color: "#a78bfa" }}>
            GAMEARENAHQ.XYZ · free skill games on Celo
          </div>
        </div>

        {/* right · the pet */}
        {petData && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 320 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${Buffer.from(petData).toString("base64")}`}
              alt=""
              width={300}
              height={300}
              style={{ objectFit: "contain" }}
            />
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
