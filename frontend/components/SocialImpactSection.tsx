"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

// ─── SocialImpactSection ────────────────────────────────────────────────────
// Compact "we're doing something good" strip for the Habitats tab. Written
// in plain English so a player who has never heard of UBI still gets it
// from one read. The number is wrapped in a clear sentence rather than
// labeled with crypto jargon (no "UBI POOL" eyebrows).
//
// Reads from Goldsky subgraph directly so it works without backend deploys.

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  "https://api.goldsky.com/api/public/project_cmoksri59dxju01rs5d317ax0/subgraphs/gamearena/1.0.0/gn";

function fmtG(raw: string): string {
  try {
    const whole = BigInt(raw) / 10n ** 18n;
    return Number(whole).toLocaleString();
  } catch {
    return "0";
  }
}

export function SocialImpactSection({ myUbiG }: { myUbiG: bigint }) {
  const isMobile = useIsMobile();

  const [global, setGlobal] = useState<{
    totalUbiDonatedG: string;
    totalHabitatUnlocks: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(SUBGRAPH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `{ globalStat(id: "global") { totalUbiDonatedG totalHabitatUnlocks } }`,
          }),
        });
        if (!r.ok) return;
        const json = await r.json();
        if (!cancelled && json?.data?.globalStat) setGlobal(json.data.globalStat);
      } catch { /* offline */ }
    };
    load();
    const id = setInterval(() => { if (!document.hidden) void load(); }, 60_000) /* a tab nobody is looking at does not need fresh data */;
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const community = fmtG(global?.totalUbiDonatedG || "0");
  const communityNum = Number(community.replace(/,/g, ""));
  const my = fmtG(myUbiG.toString());
  const myNum = Number(my);

  return (
    <div style={{
      width: "100%",
      borderRadius: "14px",
      padding: "1.5px",
      background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 50%, #a78bfa 100%)",
      boxShadow: "0 0 14px rgba(34,197,94,0.18)",
      marginBottom: "12px",
    }}>
      <div style={{
        position: "relative",
        borderRadius: "13px",
        background: "linear-gradient(180deg, #0d2818 0%, #0a0420 100%)",
        padding: isMobile ? "12px 14px" : "14px 18px",
        overflow: "hidden",
      }}>
        {/* Subtle atmospheric glow */}
        <div style={{
          position: "absolute", top: "-50%", right: "-15%",
          width: "50%", aspectRatio: "1", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />

        <div style={{
          position: "relative", zIndex: 1,
          display: "flex",
          alignItems: isMobile ? "flex-start" : "center",
          gap: isMobile ? "10px" : "14px",
        }}>
          {/* Globe icon */}
          <div style={{
            width: 40, height: 40, borderRadius: "12px",
            background: "rgba(34,197,94,0.18)",
            border: "1px solid rgba(34,197,94,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, flexShrink: 0,
          }}>🌍</div>

          {/* Story line — leads with the cause-and-effect so players who
              don't know the mechanic immediately understand: unlocking a
              habitat is how the contribution happens. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: "white",
              fontSize: isMobile ? "12.5px" : "13.5px",
              fontWeight: 800,
              lineHeight: 1.4,
            }}>
              Every habitat unlock funds <span style={{ color: "#86efac" }}>real income</span> for verified humans
            </div>
            <div style={{
              color: "rgba(220,255,225,0.65)",
              fontSize: isMobile ? "10.5px" : "11px",
              marginTop: "3px",
              lineHeight: 1.35,
            }}>
              {communityNum > 0 ? (
                <>
                  Players have given{" "}
                  <span style={{
                    color: "#86efac",
                    fontWeight: 900,
                    textShadow: "0 0 8px rgba(134,239,172,0.4)",
                  }}>{community} G$</span>{" "}
                  to GoodDollar so far
                  {myNum > 0 && (
                    <>
                      {" · "}
                      <span style={{ color: "#fbbf24", fontWeight: 800 }}>
                        You: {my} G$
                      </span>
                    </>
                  )}
                </>
              ) : (
                "Be the first to fund verified humans on GoodDollar"
              )}
            </div>
          </div>

          {/* Trust chip — desktop only, mobile drops it to keep one line */}
          {!isMobile && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              padding: "4px 10px", borderRadius: "999px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              flexShrink: 0,
            }}>
              <span style={{ color: "#86efac", fontSize: 9, fontWeight: 900 }}>✓</span>
              <span style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: "9px", fontWeight: 800,
                letterSpacing: "0.1em",
              }}>VERIFIED ON CELO</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
