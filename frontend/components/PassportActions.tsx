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
  // this sits on the light passport page: dark text, not the old light-on-dark
  inkDim: "#22104f",
  inkSoft: "rgba(34,16,79,0.68)",
  hairline: "rgba(76,29,149,0.16)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export default function PassportActions({ address, name, refCode }: { address: string; name: string; refCode?: string | null }) {
  const { address: viewer } = useAccount();
  const isOwner = !!viewer && viewer.toLowerCase() === address.toLowerCase();
  const [copied, setCopied] = useState(false);

  // Your referral scoreboard · a referral counts when the friend gets
  // VERIFIED (mints their GamePass) — not tied to any season event.
  const [refCount, setRefCount] = useState<number | null>(null);
  const [refVerified, setRefVerified] = useState<number | null>(null);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch(`/api/ref/count?wallet=${address}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (typeof d?.count === "number") setRefCount(d.count);
        if (typeof d?.verified === "number") setRefVerified(d.verified);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOwner, address]);

  // Landing on a shared passport IS the referral moment — bank the ref.
  useEffect(() => {
    try { captureReferralFromUrl(); } catch {}
  }, []);

  // Share links use the username as the code when it exists (?ref=ogazboiz —
  // memorable, speakable) and fall back to the address.
  const code = refCode || address;
  const base = typeof window !== "undefined" ? window.location.origin : "https://gamearenahq.xyz";
  const passUrl = useMemo(() => `${base}/pass/${code}?ref=${code}`, [base, code]);
  const playUrl = useMemo(() => `${base}/?ref=${code}`, [base, code]);

  // Save the passport as a PNG · reuses the OG card (it IS the designed
  // shareable asset — one renderer, no drift). Mobile: native share sheet with
  // the image file; desktop: straight download.
  const [savingCard, setSavingCard] = useState(false);
  const saveCard = async () => {
    if (savingCard) return;
    setSavingCard(true);
    try {
      const res = await fetch(`/pass/${address}/opengraph-image`);
      const blob = await res.blob();
      const file = new File([blob], "gamearena-passport.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "My Game Arena passport", text: `My Game Arena passport ⚔️ ${passUrl}` });
          return;
        } catch { /* cancelled → fall through to download */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gamearena-passport.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch {} finally {
      setSavingCard(false);
    }
  };

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
            style={{ borderRadius: 16, border: "none", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", color: "#fff", padding: "15px", fontFamily: T.display, fontSize: 18, cursor: "pointer", boxShadow: "0 5px 0 #4c1d95" }}
          >
            {copied ? "Link copied" : "Share my passport"}
          </button>
          <button
            onClick={saveCard}
            style={{ borderRadius: 16, border: `1px solid ${T.hairline}`, background: "#fff", color: T.inkDim, padding: "13px", fontFamily: T.display, fontSize: 16, cursor: savingCard ? "wait" : "pointer" }}
          >
            {savingCard ? "Making the image…" : "Save as image"}
          </button>
          <div style={{ textAlign: "center", fontFamily: T.body, fontSize: 13, lineHeight: 1.45, color: T.inkSoft, fontWeight: 600 }}>
            {refCount !== null && refCount > 0 ? (
              <span style={{ color: "#166534" }}>🎉 {refCount} joined through you{refVerified !== null ? <> · <strong>{refVerified} verified now</strong></> : null}{refCode ? <> · code: <strong>{refCode}</strong></> : null}</span>
            ) : refCode ? (
              <>Your code is <strong style={{ color: "#6d28d9" }}>{refCode}</strong> . A referral counts once your friend verifies.</>
            ) : (
              <>A referral counts once your friend verifies.</>
            )}
          </div>
        </>
      ) : (
        <>
          <a
            href={playUrl}
            style={{ borderRadius: 16, border: "none", background: "linear-gradient(180deg, #7c3aed, #6d28d9)", color: "#fff", padding: "15px", fontFamily: T.display, fontSize: 17, cursor: "pointer", boxShadow: "0 5px 0 #4c1d95", textAlign: "center", textDecoration: "none", display: "block" }}
          >
            Think you can beat {name.replace(/^@/, "")}?
          </a>
          <div style={{ textAlign: "center", fontFamily: T.body, fontSize: 13, lineHeight: 1.45, color: T.inkSoft, fontWeight: 600 }}>
            Free to play. Nothing to download.
          </div>
        </>
      )}
    </div>
  );
}
