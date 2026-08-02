"use client";

// ─── Passport action zone (client) ───────────────────────────────────────────
// The server page doesn't know who's looking. This component does:
// · The owner sees SHARE — copies/shares their passport link stamped with
//   ?ref={their address}, feeding the existing Season referral credit
//   (capture → season_v1_referrer_intent → +100 pts per referee).
// · A visitor sees the challenge CTA into the games, also ref-stamped so the
//   passport owner gets credit for the player they pulled in.
// It also banks any ?ref on THIS page into the existing referral store, since
// a shared passport link is exactly where new players land first.

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { captureReferralFromUrl } from "@/lib/referral";

const T = {
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export default function PassportActions({ address, name }: { address: string; name: string }) {
  const { address: viewer } = useAccount();
  const isOwner = !!viewer && viewer.toLowerCase() === address.toLowerCase();
  const [copied, setCopied] = useState(false);

  // Landing on a shared passport IS the referral moment — bank the ref.
  useEffect(() => {
    try { captureReferralFromUrl(); } catch {}
  }, []);

  const base = typeof window !== "undefined" ? window.location.origin : "https://gamearenahq.xyz";
  const passUrl = useMemo(() => `${base}/pass/${address}?ref=${address}`, [base, address]);
  const playUrl = useMemo(() => `${base}/?ref=${address}`, [base, address]);

  const share = async () => {
    const text = `This is my Game Arena passport — free skill games on Celo. Think you can beat my scores?`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} · Game Arena`, text, url: passUrl });
        return;
      }
    } catch { /* fall through to copy */ }
    try {
      await navigator.clipboard.writeText(passUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {isOwner ? (
        <>
          <button
            onClick={share}
            style={{ borderRadius: 16, border: "2px solid rgba(255,255,255,0.35)", background: "linear-gradient(160deg, #d6c8ff 0%, #a78bfa 55%, #6d28d9 100%)", color: "#12043a", padding: "15px", fontFamily: T.display, fontSize: 16, letterSpacing: "0.03em", cursor: "pointer", boxShadow: "0 12px 26px -8px rgba(167,139,250,0.6)" }}
          >
            {copied ? "✓ LINK COPIED" : "📣 SHARE MY PASSPORT"}
          </button>
          <div style={{ textAlign: "center", fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>
            Friends who join from your link earn you season points
          </div>
        </>
      ) : (
        <>
          <a
            href={playUrl}
            style={{ borderRadius: 16, border: "2px solid rgba(255,255,255,0.35)", background: "linear-gradient(160deg, #6ee76e 0%, #22c55e 55%, #15803d 100%)", color: "#fff", padding: "15px", fontFamily: T.display, fontSize: 16, letterSpacing: "0.03em", cursor: "pointer", boxShadow: "0 12px 26px -8px rgba(34,197,94,0.6), 0 0 0 transparent", textAlign: "center", textDecoration: "none", textShadow: "0 2px 4px rgba(0,0,0,0.4)" }}
          >
            ⚔️ THINK YOU CAN BEAT {name.replace(/^@/, "").toUpperCase()}?
          </a>
          <div style={{ textAlign: "center", fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>
            Free · instant · on Celo — no download
          </div>
        </>
      )}
    </div>
  );
}
