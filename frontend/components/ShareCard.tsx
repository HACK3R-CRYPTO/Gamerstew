"use client";

// ─── ShareCard ────────────────────────────────────────────────────────────────
// Shareable player profile card. Opens as a full-screen modal launched from
// the profile page. Renders a fixed 1080×1350 (4:5) poster in a hidden DOM
// node at native pixel size, visually scaled to fit the viewport via CSS
// transform. When the player taps Download or Share, html-to-image snapshots
// the native-resolution node so the output PNG is always social-ready at
// 1080×1350 regardless of screen size.
//
// Why 4:5 fixed:
//   • Native X and Instagram feed ratio — no feed-crop.
//   • WhatsApp preview thumbnails render it cleanly.
//   • Story/Reel users can still screenshot the modal for 9:16 on-device.
//
// Why a hidden native-size node instead of scaling at capture time:
//   • html-to-image captures at DOM size. Having the source DOM be actually
//     1080×1350 means fonts, shadows, borders all rasterise crisp. A small
//     styled node captured with scale=3 produces blurry text on emoji.
//
// Why no text watermark over the card:
//   • The QR + URL in the footer is the "share me" affordance. A logo strip
//     across the top reads as sponsor content; a clean hero reads as the
//     player's moment.

import { useEffect, useRef, useState } from "react";
import * as htmlToImage from "html-to-image";
import QRCode from "qrcode";

type Props = {
  open: boolean;
  onClose: () => void;
  username: string;
  address: string;
  level: number;
  rhythmBest: number;
  simonBest: number;
  streak: number;
  goldBadges: number;
  tierLabel: string;          // "GOLD DIVISION", "SILVER DIVISION", etc.
  petSrc: string;
  petName: string;
  avatarUrl: string;
};

const PLAY_URL = "https://gamearenahq.xyz/";
// Brand palette — mirrors /profile so the card reads as Game Arena content.
const GOLD = "#fbbf24";
const MAGENTA = "#c026d3";
const ROYAL = "#6a18c8";

export default function ShareCard(props: Props) {
  const { open, onClose, username, address, level, rhythmBest, simonBest, streak, goldBadges, tierLabel, petSrc, petName, avatarUrl } = props;

  // Two card nodes:
  //   cardRef       → off-screen, native 1080×1350, no transform (capture target)
  //   previewRef    → visible in the modal, CSS-scaled to fit the viewport
  // Previously we captured the visible node, but the scale transform made
  // html-to-image rasterise a shrunk card in the top-left of a 1080×1350
  // canvas with black padding filling the rest. Rendering twice is cheap
  // compared to the export cost and gives us crisp output every time.
  const cardRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [working, setWorking] = useState<"idle" | "rendering" | "sharing">("idle");
  const [toast, setToast] = useState<string | null>(null);

  // Generate QR at mount — cheap and keeps the card self-contained.
  useEffect(() => {
    QRCode.toDataURL(PLAY_URL, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 360,
      color: { dark: "#0a0120", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, []);

  // Lock body scroll while modal is open, restore on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;

  // Helper — renders the card node to PNG. Uses pixelRatio=1 because the
  // node is already at native 1080×1350; any extra pixelRatio just bloats
  // the output without adding detail.
  const toPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    setWorking("rendering");
    try {
      const dataUrl = await htmlToImage.toPng(cardRef.current, {
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#0a0120",
      });
      return dataUrl;
    } catch {
      return null;
    } finally {
      setWorking("idle");
    }
  };

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const onDownload = async () => {
    const dataUrl = await toPng();
    if (!dataUrl) { flashToast("Could not export. Try again."); return; }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `game-arena-${username.toLowerCase()}-lv${level}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flashToast("Saved to your device");
  };

  const onShare = async () => {
    setWorking("sharing");
    const dataUrl = await toPng();
    if (!dataUrl) { setWorking("idle"); flashToast("Could not export."); return; }
    const shareText = `LV.${level} on Game Arena. Come play: ${PLAY_URL}`;

    // Native share (mobile Safari, Chrome Android, modern Edge/Chrome on
    // PWAs): attaches the image + text in one sheet. Falls through to the
    // desktop path if the device can't share files (desktop Firefox, older
    // browsers).
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `game-arena-${username}-lv${level}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] }) && typeof navigator.share === "function") {
        await navigator.share({ files: [file], title: "Game Arena", text: shareText });
        setWorking("idle");
        return;
      }
    } catch {
      // User cancelled the native sheet, or share failed. Fall through.
    }

    // Desktop / no-share-API fallback:
    //   1) download the PNG so the player has it in their downloads folder.
    //   2) copy the share text to clipboard so they can paste into X/WhatsApp.
    // We avoid window.open here because popup blockers fire after the
    // async export and the tab would be silently blocked anyway.
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `game-arena-${username.toLowerCase()}-lv${level}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    let copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
        copied = true;
      } catch {
        copied = false;
      }
    }

    setWorking("idle");
    flashToast(copied
      ? "Image saved. Caption copied — paste into your post."
      : "Image saved. Attach it to your post.");
  };

  // ─── Stat tile ─────────────────────────────────────────────────────────
  // Inline component for the 2×2 grid. Kept local because its styling is
  // tied to the 1080×1350 canvas dimensions and would be noise elsewhere.
  const StatTile = ({ icon, value, label, accent }: { icon: string; value: string | number; label: string; accent: string }) => (
    <div style={{
      flex: 1,
      minHeight: 0,
      borderRadius: 28,
      padding: 28,
      background: "linear-gradient(180deg, rgba(20,10,50,0.92), rgba(6,1,22,0.96))",
      border: `3px solid ${accent}`,
      boxShadow: `0 0 32px ${accent}55, inset 0 4px 14px rgba(255,255,255,0.08)`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    }}>
      <div style={{ fontSize: 52, lineHeight: 1 }}>{icon}</div>
      <div>
        <div style={{
          color: accent,
          fontSize: 68,
          fontWeight: 900,
          lineHeight: 1,
          textShadow: `0 0 24px ${accent}aa`,
        }}>{value}</div>
        <div style={{
          color: "rgba(220,200,255,0.7)",
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: "0.22em",
          marginTop: 10,
        }}>{label}</div>
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(4,0,20,0.88)",
        backdropFilter: "blur(8px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(16px, 3vh, 28px)",
        overflow: "auto",
      }}
    >
      {/* Card stage — scales the native 1080×1350 node to viewport.
          Clamp the scale to 0.95 so the card never overflows its own
          container on tiny screens, and use both vw and vh so whichever
          axis is tighter sets the scale. */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(92vw, 560px)",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "clamp(12px, 2vh, 20px)",
        }}
      >
        {/* Scaled preview wrapper. The inner node is actual 1080×1350; we
            scale via CSS transform so visual preview fits the phone. The
            wrapper takes on the post-scale dimensions so layout flows. */}
        <div
          style={{
            width: "100%",
            aspectRatio: "4 / 5",
            position: "relative",
            borderRadius: 28,
            overflow: "hidden",
            boxShadow: "0 30px 60px rgba(0,0,0,0.7), 0 0 80px rgba(106,24,200,0.35)",
          }}
        >
          {/* Visible preview — CSS-scaled copy. This is what the user sees.
              Keeps transform + CSS var scaling logic so the card fits any
              viewport width without media queries. */}
          <div
            ref={previewRef}
            style={{
              width: 1080,
              height: 1350,
              transformOrigin: "top left",
              position: "absolute",
              top: 0,
              left: 0,
              transform: "scale(var(--card-scale))",
              ["--card-scale" as string]: "0.4",
            }}
          >
            <CardBody
              username={username}
              shortAddr={shortAddr}
              level={level}
              rhythmBest={rhythmBest}
              simonBest={simonBest}
              streak={streak}
              goldBadges={goldBadges}
              tierLabel={tierLabel}
              petSrc={petSrc}
              petName={petName}
              avatarUrl={avatarUrl}
              qrDataUrl={qrDataUrl}
              StatTile={StatTile}
            />
          </div>
          <CardScaleFit cardRef={previewRef} />
        </div>

        {/* Capture target — the real 1080×1350 node, no transform, rendered
            off-screen so it never affects layout or visuals. html-to-image
            snapshots this so the PNG is always crisp and exactly 1080×1350. */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: -99999,
            width: 1080,
            height: 1350,
            pointerEvents: "none",
            zIndex: -1,
          }}
        >
          <div ref={cardRef} style={{ width: 1080, height: 1350 }}>
            <CardBody
              username={username}
              shortAddr={shortAddr}
              level={level}
              rhythmBest={rhythmBest}
              simonBest={simonBest}
              streak={streak}
              goldBadges={goldBadges}
              tierLabel={tierLabel}
              petSrc={petSrc}
              petName={petName}
              avatarUrl={avatarUrl}
              qrDataUrl={qrDataUrl}
              StatTile={StatTile}
            />
          </div>
        </div>

        {/* Buttons */}
        <div style={{
          display: "flex",
          gap: 12,
          width: "100%",
          flexWrap: "wrap",
          justifyContent: "center",
        }}>
          <button
            onClick={onDownload}
            disabled={working !== "idle"}
            style={{
              flex: "1 1 160px",
              padding: "14px 22px",
              borderRadius: 14,
              border: "2px solid rgba(255,255,255,0.5)",
              background: `linear-gradient(160deg, #fde68a 0%, ${GOLD} 50%, #b45309 100%)`,
              color: "white",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: "0.14em",
              cursor: working !== "idle" ? "wait" : "pointer",
              boxShadow: `0 10px 22px rgba(251,191,36,0.55), inset 0 3px 8px rgba(255,255,255,0.5)`,
              opacity: working !== "idle" ? 0.7 : 1,
              textShadow: "0 2px 4px rgba(0,0,0,0.45)",
            }}
          >
            {working === "rendering" ? "SAVING..." : "DOWNLOAD"}
          </button>

          <button
            onClick={onShare}
            disabled={working !== "idle"}
            style={{
              flex: "1 1 160px",
              padding: "14px 22px",
              borderRadius: 14,
              border: "2px solid rgba(255,255,255,0.45)",
              background: `linear-gradient(160deg, #67e8f9 0%, #06b6d4 50%, #0e7490 100%)`,
              color: "white",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: "0.14em",
              cursor: working !== "idle" ? "wait" : "pointer",
              boxShadow: `0 10px 22px rgba(6,182,212,0.5), inset 0 3px 8px rgba(255,255,255,0.5)`,
              opacity: working !== "idle" ? 0.7 : 1,
              textShadow: "0 2px 4px rgba(0,0,0,0.45)",
            }}
          >
            {working === "sharing" ? "SHARING..." : "SHARE"}
          </button>

          <button
            onClick={onClose}
            style={{
              flex: "0 0 auto",
              padding: "14px 18px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(20,10,50,0.6)",
              color: "rgba(230,220,255,0.85)",
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "0.12em",
              cursor: "pointer",
            }}
          >
            CLOSE
          </button>
        </div>

        {toast && (
          <div style={{
            padding: "10px 16px",
            borderRadius: 999,
            background: "rgba(20,10,50,0.92)",
            border: "1px solid rgba(200,170,255,0.3)",
            color: "rgba(230,220,255,0.9)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.06em",
          }}>{toast}</div>
        )}
      </div>
    </div>
  );
}

// ─── CardScaleFit ─────────────────────────────────────────────────────────────
// Tiny helper that measures the parent's computed width on mount + resize and
// writes a CSS var on the card so the 1080-wide source scales to fit. Written
// as a separate component so the effect doesn't clutter the main render.
function CardScaleFit({ cardRef }: { cardRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const update = () => {
      const w = parent.clientWidth;
      el.style.setProperty("--card-scale", String(w / 1080));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, [cardRef]);
  return null;
}

// ─── CardBody ─────────────────────────────────────────────────────────────────
// The actual 1080×1350 poster. Kept as a standalone component so we could
// export it for server-side PNG generation later without importing the modal
// shell. All measurements are pixel-fixed (no clamp/vw) because the canvas
// has a known size and needs to rasterise identically everywhere.
function CardBody({
  username, shortAddr, level, rhythmBest, simonBest, streak, goldBadges, tierLabel,
  petSrc, petName, avatarUrl, qrDataUrl, StatTile,
}: {
  username: string;
  shortAddr: string;
  level: number;
  rhythmBest: number;
  simonBest: number;
  streak: number;
  goldBadges: number;
  tierLabel: string;
  petSrc: string;
  petName: string;
  avatarUrl: string;
  qrDataUrl: string;
  StatTile: (p: { icon: string; value: string | number; label: string; accent: string }) => React.JSX.Element;
}) {
  return (
    <div style={{
      width: 1080,
      height: 1350,
      padding: 60,
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: 36,
      fontFamily: "'Arial Rounded MT Bold', 'Fredoka One', 'Nunito', sans-serif",
      color: "white",
      background: `
        radial-gradient(ellipse 80% 60% at 50% 15%, #8b2bff 0%, ${ROYAL} 30%, #1a044a 60%, #0a0120 100%),
        radial-gradient(circle at 20% 80%, rgba(192,38,211,0.4), transparent 40%)
      `,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Decorative glow ring — same magenta wash used on the in-app vignette */}
      <div style={{
        position: "absolute",
        inset: 40,
        borderRadius: 40,
        border: `3px solid ${MAGENTA}55`,
        boxShadow: `0 0 80px ${MAGENTA}33`,
        pointerEvents: "none",
      }} />

      {/* ─── HEADER STRIP ─────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 72,
      }}>
        <div style={{
          color: GOLD,
          fontSize: 22,
          fontWeight: 900,
          letterSpacing: "0.42em",
          textShadow: `0 0 18px ${GOLD}99`,
        }}>GAME ARENA</div>

        <div style={{
          padding: "10px 22px",
          borderRadius: 999,
          background: `linear-gradient(135deg, ${GOLD}, #b45309)`,
          border: "2.5px solid rgba(255,255,255,0.5)",
          color: "white",
          fontSize: 18,
          fontWeight: 900,
          letterSpacing: "0.18em",
          textShadow: "0 2px 4px rgba(0,0,0,0.45)",
          boxShadow: `0 8px 22px ${GOLD}66`,
        }}>{tierLabel}</div>
      </div>

      {/* ─── HERO ROW — avatar + username + LV, with pet on the right ──── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 40,
        paddingTop: 10,
      }}>
        {/* Avatar */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl}
          alt=""
          width={180}
          height={180}
          crossOrigin="anonymous"
          style={{
            width: 180,
            height: 180,
            borderRadius: "50%",
            background: "rgba(20,10,50,0.6)",
            border: `4px solid ${MAGENTA}`,
            boxShadow: `0 0 40px ${MAGENTA}77`,
            flexShrink: 0,
          }}
        />

        {/* Username + level block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 56,
            fontWeight: 900,
            letterSpacing: "0.02em",
            lineHeight: 1.05,
            color: "white",
            textShadow: "0 4px 16px rgba(0,0,0,0.6)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {username.slice(0, 14)}
          </div>
          <div style={{
            fontSize: 20,
            color: "rgba(200,180,255,0.7)",
            fontFamily: "monospace",
            marginTop: 4,
          }}>{shortAddr}</div>
          <div style={{
            marginTop: 16,
            display: "flex",
            alignItems: "baseline",
            gap: 14,
          }}>
            <span style={{
              fontSize: 28,
              fontWeight: 900,
              color: "rgba(254,215,170,0.85)",
              letterSpacing: "0.28em",
              textShadow: `0 0 18px ${GOLD}88`,
            }}>LEVEL</span>
            <span style={{
              fontSize: 128,
              fontWeight: 900,
              lineHeight: 0.9,
              color: GOLD,
              textShadow: `0 0 40px ${GOLD}bb, 0 0 80px ${GOLD}55, 0 6px 12px rgba(0,0,0,0.7)`,
              WebkitTextStroke: `3px ${GOLD}`,
            }}>{level}</span>
          </div>
        </div>

        {/* Pet portrait — the unique Game Arena brand hook */}
        <div style={{
          width: 260,
          height: 260,
          borderRadius: 32,
          background: `radial-gradient(circle at 50% 40%, rgba(192,38,211,0.35), transparent 70%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          position: "relative",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={petSrc}
            alt=""
            width={240}
            height={240}
            crossOrigin="anonymous"
            style={{
              width: "88%",
              height: "88%",
              objectFit: "contain",
              filter: `drop-shadow(0 10px 24px rgba(0,0,0,0.7)) drop-shadow(0 0 40px ${MAGENTA}55)`,
            }}
          />
          <div style={{
            position: "absolute",
            bottom: -4,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "rgba(255,235,180,0.85)",
            fontSize: 16,
            fontWeight: 900,
            letterSpacing: "0.22em",
            textShadow: "0 2px 6px rgba(0,0,0,0.6)",
          }}>{petName.toUpperCase()}</div>
        </div>
      </div>

      {/* ─── 2×2 STAT GRID ────────────────────────────────────── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 24,
      }}>
        <StatTile icon="🥁" value={rhythmBest.toLocaleString()} label="RHYTHM BEST" accent={MAGENTA} />
        <StatTile icon="🧠" value={simonBest.toLocaleString()} label="SIMON BEST" accent="#06b6d4" />
        <StatTile icon="🔥" value={streak} label={streak === 1 ? "DAY STREAK" : "DAY STREAK"} accent="#f97316" />
        <StatTile icon="🏅" value={goldBadges} label={goldBadges === 1 ? "GOLD BADGE" : "GOLD BADGES"} accent={GOLD} />
      </div>

      {/* ─── FOOTER — URL + QR ───────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 28,
        height: 128,
      }}>
        <div>
          <div style={{
            color: "rgba(220,200,255,0.6)",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "0.24em",
            marginBottom: 6,
          }}>PLAY FREE</div>
          <div style={{
            color: GOLD,
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: "0.04em",
            textShadow: `0 0 18px ${GOLD}77`,
          }}>gamearenahq.xyz</div>
        </div>

        {qrDataUrl && (
          <div style={{
            padding: 12,
            borderRadius: 16,
            background: "white",
            boxShadow: `0 0 0 3px ${GOLD}, 0 0 30px ${GOLD}55`,
            flexShrink: 0,
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="" width={108} height={108} style={{ display: "block", width: 108, height: 108 }} />
          </div>
        )}
      </div>
    </div>
  );
}
