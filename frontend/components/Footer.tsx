"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Reviewer-facing trust strip. Required by MiniPay submission
// (celopedia minipay-requirements §6 "Integration & Support" and §7
// "Branding & Legal"): in-app support link, Terms + Privacy
// reachability, and a public analytics surface. Sits at the bottom of
// non-immersive pages so a reviewer scanning the app never has to hunt
// for these links.
//
// Hidden on game-play routes because the focused canvases (rhythm, simon,
// match) own the whole viewport; a footer there would clip into
// gameplay. Reviewers visit /games, /profile, /leaderboard etc. to see
// the platform surface, not the games themselves.
const HIDE_ON = [
  "/games/rhythm",
  "/games/simon",
  "/games/challenge-ai/match",
  "/connect",
  "/mint",
  "/verify",
];

const LINKS = {
  TELEGRAM: "https://t.me/+oY4inbBoglViNmE0",
  DUNE: "https://dune.com/ogazboiz/gamearena",
  CELOSCAN_GAMEPASS: "https://celoscan.io/address/0xBB044d6780885A4cDb7E6F40FCc92FF7b051DAdE",
};

export default function Footer() {
  const pathname = usePathname() || "/";
  if (HIDE_ON.some(prefix => pathname.startsWith(prefix))) return null;

  return (
    <footer style={{
      width: "100%", marginTop: "auto", paddingBottom: "max(20px, env(safe-area-inset-bottom, 0px))",
      paddingTop: "32px", paddingLeft: "20px", paddingRight: "20px",
      background: "rgba(10, 1, 32, 0.4)",
      borderTop: "1px solid rgba(167, 139, 250, 0.18)",
      color: "rgba(220, 210, 255, 0.55)",
      fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em",
      position: "relative", zIndex: 1,
    }}>
      <div style={{
        maxWidth: "880px", margin: "0 auto",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: "16px",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          flexWrap: "wrap", gap: "16px",
        }}>
          <a href={LINKS.TELEGRAM} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            💬 Support
          </a>
          <span style={dotStyle}>·</span>
          <a href={LINKS.DUNE} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            📊 Analytics (Dune)
          </a>
          <span style={dotStyle}>·</span>
          <a href={LINKS.CELOSCAN_GAMEPASS} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            🔗 Contracts (Celoscan)
          </a>
          <span style={dotStyle}>·</span>
          <Link href="/terms" style={linkStyle}>Terms</Link>
          <span style={dotStyle}>·</span>
          <Link href="/privacy" style={linkStyle}>Privacy</Link>
        </div>
        <div style={{
          color: "rgba(220, 210, 255, 0.35)",
          fontSize: "10px", fontWeight: 500, textAlign: "center",
          letterSpacing: "0.06em",
        }}>
          Game Arena · On Celo Mainnet · Not affiliated with Opera or MiniPay
        </div>
      </div>
    </footer>
  );
}

const linkStyle: React.CSSProperties = {
  color: "rgba(220, 210, 255, 0.75)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const dotStyle: React.CSSProperties = {
  color: "rgba(167, 139, 250, 0.35)",
  fontSize: "14px",
};
