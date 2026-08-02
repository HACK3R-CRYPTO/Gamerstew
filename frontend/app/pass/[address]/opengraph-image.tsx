// ─── Per-player OG card · 1200×630 ──────────────────────────────────────────
// Mirrors the passport hero instead of a flat gradient: the player's equipped
// HABITAT is the scene, their pet stands in it, name + rank + stats ride a
// dark bottom gradient (WCAG-grade legibility over imagery — the NN/g
// text-over-images rule). This is the card people save and the card link
// previews show — one asset, both jobs.

import { ImageResponse } from "next/og";
import { getPassport, resolvePassHandle } from "@/lib/passport";

export const alt = "Game Arena player passport";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ASSET_BASE = "https://gamearenahq.xyz";

async function fetchAsset(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${ASSET_BASE}${path}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ext = path.endsWith(".jpg") || path.endsWith(".jpeg") ? "jpeg" : "png";
    return `data:image/${ext};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address: handle } = await params;
  const resolved = await resolvePassHandle(handle).catch(() => null);
  const p = resolved ? await getPassport(resolved).catch(() => null) : null;

  const name = p ? (p.username ? `@${p.username.replace(/^@/, "")}` : `${p.address.slice(0, 6)}…${p.address.slice(-4)}`) : "Player";
  const totalBadges = p ? p.badges.gold + p.badges.silver + p.badges.bronze : 0;

  const [habitatBg, petImg] = await Promise.all([
    p?.habitat?.bgImage ? fetchAsset(p.habitat.bgImage) : Promise.resolve(null),
    fetchAsset(p?.pet.src || "/pets/stage-1-egg.png"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 55%, #0a0226 100%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        {/* the habitat is the scene */}
        {habitatBg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={habitatBg} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
        )}
        {/* legibility gradient · dark floor rising from the bottom */}
        <div style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, display: "flex", background: "linear-gradient(180deg, rgba(10,2,38,0.18) 0%, rgba(10,2,38,0.55) 55%, rgba(10,2,38,0.94) 100%)" }} />

        {/* pet · standing in its world, right side */}
        {petImg && (
          <div style={{ position: "absolute", right: 90, top: 130, display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={petImg} alt="" width={290} height={290} style={{ objectFit: "contain" }} />
          </div>
        )}

        {/* identity + boast · anchored on the dark floor */}
        <div style={{ position: "absolute", left: 96, bottom: 84, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", fontSize: 58, fontWeight: 800, textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>{name}</div>
            {p?.minted && (
              <div style={{ display: "flex", fontSize: 19, fontWeight: 800, color: "#86efac", background: "rgba(10,40,20,0.75)", border: "2px solid rgba(134,239,172,0.6)", borderRadius: 999, padding: "7px 18px" }}>
                VERIFIED
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
            {p?.rank && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, background: "rgba(10,2,38,0.72)", border: "2px solid rgba(251,191,36,0.55)", borderRadius: 18, padding: "12px 24px" }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#fbbf24" }}>#{p.rank}</div>
                <div style={{ display: "flex", fontSize: 19, color: "rgba(220,210,255,0.85)", fontWeight: 700 }}>all-time</div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", background: "rgba(10,2,38,0.72)", border: "2px solid rgba(255,255,255,0.18)", borderRadius: 18, padding: "12px 24px", fontSize: 24, fontWeight: 700, color: "rgba(230,222,255,0.95)" }}>
              LV {p?.level ?? 1} · {p?.gamesPlayed ?? 0} games{totalBadges > 0 ? ` · 🏅 ${totalBadges}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", marginTop: 24, fontSize: 22, fontWeight: 800, color: "#c4b5fd", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
            GAMEARENAHQ.XYZ · free skill games on Celo · think you can beat me?
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
