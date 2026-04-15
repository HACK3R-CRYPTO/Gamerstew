"use client";

import { useRouter } from "next/navigation";

const D = "/splash_screen_icons/dice.png";
const G = "/splash_screen_icons/gamepad.png";
const J = "/splash_screen_icons/joystick.png";
const M = "/splash_screen_icons/golden_music.png";
const V = "/splash_screen_icons/vending.png";

const LEFT_ICONS = [
  { src: D, top: "1%", left: "-18px", size: 120, delay: 0.0, dur: 5.2, glow: "#cc44ff", rotate: -18 },
  { src: M, top: "8%", left: "34px", size: 80, delay: 0.7, dur: 4.3, glow: "#ffaa00", rotate: 12 },
  { src: G, top: "24%", left: "6px", size: 110, delay: 1.4, dur: 6.0, glow: "#aa88ff", rotate: -6 },
  { src: D, top: "36%", left: "72px", size: 140, delay: 0.3, dur: 4.8, glow: "#cc44ff", rotate: 16 },
  { src: J, top: "54%", left: "-10px", size: 105, delay: 2.1, dur: 5.5, glow: "#22aaff", rotate: -8 },
  { src: G, top: "72%", left: "4px", size: 108, delay: 2.8, dur: 5.0, glow: "#aa88ff", rotate: -14 },
  { src: D, top: "88%", left: "60px", size: 95, delay: 1.9, dur: 4.6, glow: "#cc44ff", rotate: 10 },
];

const RIGHT_ICONS = [
  { src: D, top: "0%", right: "-22px", size: 115, delay: 0.4, dur: 5.0, glow: "#cc44ff", rotate: 20 },
  { src: J, top: "16%", right: "54px", size: 100, delay: 1.2, dur: 4.8, glow: "#22aaff", rotate: 8 },
  { src: V, top: "30%", right: "0px", size: 120, delay: 2.0, dur: 6.2, glow: "#ff44cc", rotate: -4 },
  { src: M, top: "50%", right: "44px", size: 82, delay: 0.6, dur: 4.0, glow: "#ffaa00", rotate: -16 },
  { src: D, top: "65%", right: "-8px", size: 100, delay: 2.4, dur: 5.2, glow: "#cc44ff", rotate: 10 },
  { src: G, top: "80%", right: "58px", size: 108, delay: 1.8, dur: 5.8, glow: "#aa88ff", rotate: -10 },
];

const GamepadIcon = () => (
  <svg width="76" height="76" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(0px 2px 0px rgba(255,255,255,0.45))" }}>
    <mask id="gamepadMask">
      <rect width="100" height="100" fill="white" />
      <rect x="23" y="40" width="8" height="24" rx="2" fill="black" />
      <rect x="15" y="48" width="24" height="8" rx="2" fill="black" />
      <circle cx="75" cy="44" r="4" fill="black" />
      <circle cx="75" cy="62" r="4" fill="black" />
      <circle cx="66" cy="53" r="4" fill="black" />
      <circle cx="84" cy="53" r="4" fill="black" />
    </mask>
    <path mask="url(#gamepadMask)" fill="currentColor" fillRule="evenodd" clipRule="evenodd"
      d="M25 25C11.1929 25 2 36.1929 2 50C2 60.5902 6.58151 72.8804 15.6565 77.0673C19.7891 78.9745 25 76.7725 28.5839 73.1887L31.2582 70.5143C34.6293 67.1432 39.2608 65 44 65H56C60.7392 65 65.3707 67.1432 68.7418 70.5143L71.4161 73.1887C75 76.7725 80.2109 78.9745 84.3435 77.0673C93.4185 72.8804 98 60.5902 98 50C98 36.1929 88.8071 25 75 25H25Z" 
    />
  </svg>
);

const RobotIcon = () => (
  <svg width="80" height="80" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(0px 2px 0px rgba(255,255,255,0.45))" }}>
    <mask id="robotMask">
      <rect width="100" height="100" fill="white" />
      <circle cx="35" cy="55" r="5" fill="black" />
      <circle cx="65" cy="55" r="5" fill="black" />
      <rect x="42" y="65" width="16" height="4" rx="2" fill="black" />
    </mask>
    <g mask="url(#robotMask)" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M32 30C20.9543 30 12 38.9543 12 50V60C12 71.0457 20.9543 80 32 80H68C79.0457 80 88 71.0457 88 60V50C88 38.9543 79.0457 30 68 30H32ZM47 18V30H53V18H47ZM4 48C4 45.7909 5.79086 44 8 44H12V66H8C5.79086 66 4 64.2091 4 62V48ZM92 44C89.7909 44 88 45.7909 88 48V62C88 64.2091 89.7909 66 92 66H96C98.2091 66 100 64.2091 100 62V48C100 45.7909 98.2091 44 96 44H92Z" />
      <circle cx="50" cy="14" r="6" />
    </g>
  </svg>
);

import { useState } from "react";

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClose}
      style={{ cursor: "pointer", userSelect: "none", flexShrink: 0 }}
      onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.88) translateY(4px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
    >
      {/* Wall */}
      <div style={{
        width: "38px", height: "38px",
        borderRadius: "12px",
        background: "#6b0000",
        paddingBottom: "5px",
        boxShadow: "0 8px 16px -4px rgba(200,0,0,0.55), inset 0 -3px 6px rgba(0,0,0,0.4)"
      }}>
        {/* Face */}
        <div style={{
          width: "100%", height: "100%",
          borderRadius: "12px 12px 8px 8px",
          background: "linear-gradient(160deg, #ff6060 0%, #ee1111 50%, #b00000 100%)",
          position: "relative", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0px 6px 12px rgba(255,255,255,0.75), inset 0px -4px 8px rgba(0,0,0,0.3)"
        }}>
          {/* Gloss */}
          <div style={{
            position: "absolute", top: "2px", left: "5%", right: "5%", height: "50%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 100%)",
            borderRadius: "10px 10px 50px 50px", pointerEvents: "none"
          }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" style={{ zIndex: 1, filter: "drop-shadow(0px 1px 0px rgba(0,0,0,0.4))" }}>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function GamePanel({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(4,0,20,0.75)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.2s ease both", padding: "20px"
      }}
    >
      {/* Outer wall gives the 3D border/glow rim */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: "480px", maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          borderRadius: "28px",
          background: "#1a0550",
          paddingBottom: "8px",
          boxShadow: "0 0 0 3px #5b21b6, 0 0 60px rgba(109,40,217,0.6), 0 40px 80px rgba(0,0,0,0.95)",
          animation: "scaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Inner face panel — flex column so header is fixed, body scrolls */}
        <div style={{
          flex: 1, minHeight: 0,
          display: "flex", flexDirection: "column",
          borderRadius: "26px 26px 20px 20px",
          background: "linear-gradient(180deg, #2a0c6e 0%, #13063a 45%, #07021a 100%)",
          border: "2px solid rgba(255,255,255,0.12)",
          boxShadow: "inset 0 8px 24px rgba(160,100,255,0.15), inset 0 -4px 12px rgba(0,0,0,0.5)",
          color: "white",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Top gloss strip — purely decorative, sits behind content */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "80px",
            background: "linear-gradient(180deg, rgba(200,160,255,0.14) 0%, rgba(200,160,255,0) 100%)",
            borderRadius: "26px 26px 0 0", pointerEvents: "none", zIndex: 0
          }} />
          {/* Scrollable content wrapper */}
          <div style={{ position: "relative", zIndex: 1, overflowY: "auto", flex: 1, minHeight: 0 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Header banner wall */}
      <div style={{
        background: "linear-gradient(90deg, #2d0b8c 0%, #6d28d9 50%, #2d0b8c 100%)",
        borderRadius: "26px 26px 0 0",
        paddingBottom: "4px",
      }}>
        {/* Header banner face */}
        <div style={{
          background: "linear-gradient(90deg, #4c1d95 0%, #7c3aed 40%, #9333ea 60%, #7c3aed 80%, #4c1d95 100%)",
          borderRadius: "26px 26px 0 0",
          padding: "20px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "relative", overflow: "hidden",
          borderBottom: "2px solid rgba(255,255,255,0.18)",
          boxShadow: "inset 0 6px 16px rgba(255,255,255,0.2), inset 0 -4px 8px rgba(0,0,0,0.3)"
        }}>
          {/* Gloss */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "55%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%)",
            borderRadius: "26px 26px 60px 60px", pointerEvents: "none"
          }} />
          <h2 style={{
            fontSize: "15px", fontWeight: 900, margin: 0,
            letterSpacing: "0.12em", color: "white",
            textShadow: "0px 2px 4px rgba(0,0,0,0.5), 0 0 20px rgba(200,150,255,0.6)",
            zIndex: 1
          }}>
            {title}
          </h2>
          <CloseBtn onClose={onClose} />
        </div>
      </div>
    </div>
  );
}

// Recessed HUD display panel — for information, NOT interactive.
// Looks sunken into the UI surface like a game stat screen or item slot.
function InfoCard({ children, accentColor }: { children: React.ReactNode; accentColor?: string }) {
  return (
    <div style={{
      borderRadius: "14px",
      background: "linear-gradient(180deg, rgba(12,4,40,0.95) 0%, rgba(6,1,22,0.98) 100%)",
      border: `1px solid ${accentColor ? accentColor + "60" : "rgba(110,60,220,0.4)"}`,
      boxShadow: [
        `0 0 18px ${accentColor ? accentColor + "25" : "rgba(100,50,200,0.2)"}`,
        "inset 0 3px 10px rgba(0,0,0,0.75)",
        "inset 0 0 30px rgba(40,0,100,0.3)",
        "inset 0 1px 0 rgba(160,100,255,0.08)"
      ].join(", "),
      padding: "14px 16px",
      position: "relative", overflow: "hidden",
    }}>
      {/* Left accent strip — like item rarity bar in an RPG */}
      {accentColor && (
        <div style={{
          position: "absolute", top: 0, left: 0, bottom: 0, width: "3px",
          background: `linear-gradient(180deg, ${accentColor} 0%, ${accentColor}55 100%)`,
          borderRadius: "14px 0 0 14px",
          boxShadow: `0 0 10px ${accentColor}99`
        }} />
      )}
      <div style={{ paddingLeft: accentColor ? "10px" : 0 }}>
        {children}
      </div>
    </div>
  );
}

// Section label — horizontal rule with glowing text, like a chapter title in a game
function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "2px 0" }}>
      <div style={{
        flex: 1, height: "1px",
        background: "linear-gradient(90deg, transparent 0%, rgba(140,80,255,0.7) 100%)"
      }} />
      <span style={{
        fontSize: "10px", fontWeight: 900, letterSpacing: "0.18em",
        color: "rgba(190,150,255,0.9)",
        textShadow: "0 0 14px rgba(160,100,255,0.9), 0 0 30px rgba(130,60,255,0.5)",
        whiteSpace: "nowrap"
      }}>{label}</span>
      <div style={{
        flex: 1, height: "1px",
        background: "linear-gradient(90deg, rgba(140,80,255,0.7) 0%, transparent 100%)"
      }} />
    </div>
  );
}

function AboutModal({ onClose }: { onClose: () => void }) {
  const games = [
    { name: "RHYTHM RUSH", desc: "Tap the beat. Hit 350 pts. Win 1.3x.", accent: "#c084fc" },
    { name: "SIMON MEMORY", desc: "Repeat 7 sequences. Win 1.3x.", accent: "#a78bfa" },
    { name: "CHALLENGE AI", desc: "Beat the AI. Take 95% of the pot.", accent: "#e879f9" },
  ];

  const steps = [
    { num: "1", title: "Verify", text: "Verify with GoodDollar. Takes 1 minute." },
    { num: "2", title: "Claim", text: "Claim free G$ every week. No purchase needed." },
    { num: "3", title: "Profile", text: "Create your Game Pass. Free on-chain profile." },
    { num: "4", title: "Play", text: "Wager, play skill games, and top the leaderboard." },
  ];

  return (
    <GamePanel onClick={onClose}>
      <ModalHeader title="ABOUT GAME ARENA" onClose={onClose} />
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>

        {/* Intro panel */}
        <InfoCard>
          <p style={{ color: "rgba(255,255,255,0.88)", fontSize: "13.5px", lineHeight: 1.7, margin: 0 }}>
            Play skill games on <strong style={{ color: "#d8b4fe" }}>Celo</strong>. Wager <strong style={{ color: "#fde68a" }}>G$</strong> and win real rewards. Every wager funds <strong style={{ color: "#86efac" }}>GoodDollar UBI</strong> for real people.
          </p>
        </InfoCard>

        <SectionDivider label="THE GAMES" />

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {games.map(g => (
            <InfoCard key={g.name} accentColor={g.accent}>
              <div style={{ color: "white", fontSize: "13px", fontWeight: 900, letterSpacing: "0.06em", marginBottom: "4px" }}>{g.name}</div>
              <div style={{ color: "rgba(200,170,255,0.8)", fontSize: "12.5px", lineHeight: 1.45 }}>{g.desc}</div>
            </InfoCard>
          ))}
        </div>

        <SectionDivider label="HOW IT WORKS" />

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "8px" }}>
          {steps.map(s => (
            <InfoCard key={s.num}>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                {/* Step gem token — display badge, not a button */}
                <div style={{
                  flexShrink: 0,
                  width: "26px", height: "26px", borderRadius: "50%",
                  background: "radial-gradient(circle at 38% 32%, #c084fc, #5b21b6 70%)",
                  border: "1.5px solid rgba(200,150,255,0.5)",
                  boxShadow: "0 0 12px rgba(140,70,255,0.6), inset 0 1px 4px rgba(255,255,255,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: "11px", fontWeight: 900, color: "white", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>{s.num}</span>
                </div>
                <div>
                  <div style={{ color: "white", fontSize: "13px", fontWeight: 700, marginBottom: "3px" }}>{s.title}</div>
                  <div style={{ color: "rgba(180,150,255,0.75)", fontSize: "12.5px", lineHeight: 1.5 }}>{s.text}</div>
                </div>
              </div>
            </InfoCard>
          ))}
        </div>
      </div>
    </GamePanel>
  );
}

function SupportModal({ onClose }: { onClose: () => void }) {
  const faqs = [
    { q: "My score is not on the leaderboard", a: "Scores update every few minutes. Refresh and check again." },
    { q: "I can't claim G$", a: "Verify your identity first. Tap Verify and complete the face scan." },
    { q: "My Game Pass won't mint", a: "You need a small amount of CELO for gas. Add CELO to your wallet and retry." },
    { q: "My wallet connected but nothing loads", a: "Disconnect and reconnect. Standard social logins work best." },
    { q: "My wager went through but no reward", a: "The result settles on-chain. Check your wallet balance directly." },
  ];

  return (
    <GamePanel onClick={onClose}>
      <ModalHeader title="SUPPORT & FAQ" onClose={onClose} />
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>

        <SectionDivider label="COMMON ISSUES" />

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {faqs.map(f => (
            <InfoCard key={f.q} accentColor="#7c3aed">
              <div style={{ color: "white", fontSize: "13px", fontWeight: 700, marginBottom: "5px" }}>{f.q}</div>
              <div style={{ color: "rgba(180,150,255,0.75)", fontSize: "12.5px", lineHeight: 1.5 }}>{f.a}</div>
            </InfoCard>
          ))}
        </div>

        <SectionDivider label="STILL NEED HELP?" />

        {/* Telegram CTA — juicy teal button */}
        <a href="https://t.me/+oY4inbBoglViNmE0" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block", paddingBottom: "8px" }}>
          <div
            style={{ cursor: "pointer", userSelect: "none", transition: "transform 0.2s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"; }}
            onMouseDown={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(5px)"; }}
            onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.03) translateY(-3px)"; }}
          >
            {/* Wall */}
            <div style={{
              borderRadius: "20px",
              background: "#004d60",
              paddingBottom: "7px",
              boxShadow: "0 12px 28px -6px rgba(5,160,205,0.65), inset 0 -3px 8px rgba(0,0,0,0.4)"
            }}>
              {/* Face */}
              <div style={{
                borderRadius: "18px 18px 14px 14px",
                background: "linear-gradient(160deg, #5eead4 0%, #06b6d4 45%, #0284c7 100%)",
                padding: "18px 24px",
                position: "relative", overflow: "hidden",
                display: "flex", alignItems: "center", gap: "16px",
                border: "2.5px solid rgba(255,255,255,0.45)",
                boxShadow: "inset 0px 10px 22px rgba(255,255,255,0.8), inset 0px -5px 12px rgba(0,0,0,0.25)"
              }}>
                {/* Gloss */}
                <div style={{
                  position: "absolute", top: "2px", left: "4%", right: "4%", height: "48%",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 100%)",
                  borderRadius: "16px 16px 80px 80px", pointerEvents: "none"
                }} />
                {/* Specular */}
                <div style={{
                  position: "absolute", top: "8px", left: "16px", width: "30px", height: "12px",
                  background: "rgba(255,255,255,0.9)", borderRadius: "50%",
                  filter: "blur(2px)", transform: "rotate(-15deg)", pointerEvents: "none"
                }} />
                <div style={{ color: "white", display: "flex", zIndex: 1, filter: "drop-shadow(0px 2px 3px rgba(0,0,0,0.4))" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.19 13.367l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.958.192z"/>
                  </svg>
                </div>
                <div style={{ zIndex: 1 }}>
                  <div style={{ color: "white", fontSize: "15px", fontWeight: 900, letterSpacing: "0.04em", textShadow: "0px 2px 4px rgba(0,0,0,0.35)" }}>JOIN OUR TELEGRAM</div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "12.5px", marginTop: "3px", textShadow: "0px 1px 2px rgba(0,0,0,0.3)" }}>Drop your issue. The team responds fast.</div>
                </div>
              </div>
            </div>
          </div>
        </a>
      </div>
    </GamePanel>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [showAbout, setShowAbout] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 80% 60% at 50% 15%, #6a18c8 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)",
      }}
    >
      {/* Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(5,1,20,0.55) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Left icons */}
      {LEFT_ICONS.map((icon, i) => (
        <div
          key={`l-${i}`}
          className="icon-float"
          style={{
            position: "absolute",
            top: icon.top,
            left: icon.left,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Right icons */}
      {RIGHT_ICONS.map((icon, i) => (
        <div
          key={`r-${i}`}
          className="icon-float"
          style={{
            position: "absolute",
            top: icon.top,
            right: icon.right,
            width: icon.size,
            height: icon.size,
            transform: `rotate(${icon.rotate}deg)`,
            filter: `drop-shadow(0 0 8px ${icon.glow}99)`,
            ["--dur" as string]: `${icon.dur}s`,
            ["--delay" as string]: `${icon.delay}s`,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={icon.src} alt="" width={icon.size} height={icon.size} style={{ objectFit: "contain", display: "block" }} />
        </div>
      ))}

      {/* Top nav */}
      <nav
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "20px 32px",
          gap: "24px",
          zIndex: 10,
        }}
      >
        {/* Social icons */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <a href="https://t.me/+oY4inbBoglViNmE0" target="_blank" rel="noopener noreferrer"
            style={{ color: "white", opacity: 0.85, display: "flex", alignItems: "center" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.19 13.367l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.958.192z"/>
            </svg>
          </a>
        </div>

        {/* Nav links */}
        {["ABOUT", "LEADERBOARD", "SUPPORT"].map((label) => (
          <button
            key={label}
            onClick={() => {
              if (label === "LEADERBOARD") router.push("/leaderboard");
              if (label === "ABOUT") setShowAbout(true);
              if (label === "SUPPORT") setShowSupport(true);
            }}
            style={{
              background: "none",
              border: "none",
              color: "white",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              cursor: "pointer",
              opacity: 0.85,
              fontFamily: "inherit",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: "40px",
        }}
      >
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{
            width: "clamp(280px, 45vw, 600px)",
            height: "auto",
            animation: "bounce-scale-in 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
        />

        {/* Buttons */}
        <div style={{ display: "flex", gap: "50px", alignItems: "center" }}>
          {[
            { 
              label: "PLAY\nGAMES", 
              icon: <GamepadIcon />, 
              iconDark: "#005572", // Deep cyan/teal inset color
              path: "/games",
              gradient: "linear-gradient(160deg, #a4f480 0%, #2bd0b9 55%, #05a0cd 100%)",
              wall: "#006282", // Extremely dark heavy bottom base
              shadowGlow: "rgba(5, 160, 205, 0.6)"
            },
            { 
              label: "CHALLENGE\nAI", 
              icon: <RobotIcon />, 
              iconDark: "#6b0000", // Deep red inset color
              path: "/games/coinflip",
              gradient: "linear-gradient(160deg, #ffc76b 0%, #ff5232 50%, #cc0c0c 100%)",
              wall: "#800000",
              shadowGlow: "rgba(216, 17, 17, 0.6)"
            },
          ].map((btn) => (
            <div
              key={btn.path}
              role="button"
              tabIndex={0}
              onClick={() => router.push(btn.path)}
              style={{ cursor: "pointer", userSelect: "none", transition: "transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.15s" }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = "scale(1.08) translateY(-6px)"}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = "scale(1) translateY(0)"}
              onMouseDown={e => (e.currentTarget as HTMLDivElement).style.transform = "scale(0.92) translateY(12px)"}
              onMouseUp={e => (e.currentTarget as HTMLDivElement).style.transform = "scale(1.08) translateY(-6px)"}
            >
              {/* Outer container provides the 3D base (wall/lip) */}
              <div style={{
                width: "240px", height: "240px",
                borderRadius: "50px",
                background: btn.wall,
                paddingBottom: "22px", // Much chunkier bottom lip for that heavy jelly weight
                boxShadow: `0 24px 45px -8px ${btn.shadowGlow}, inset 0 -5px 10px rgba(0,0,0,0.4)`
              }}>
                {/* Surface of the button */}
                <div style={{
                  width: "100%", height: "100%",
                  borderRadius: "50px 50px 42px 42px",
                  background: btn.gradient,
                  position: "relative", overflow: "hidden",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "10px",
                  border: "3px solid rgba(255,255,255,0.45)", // Thicker white border inside
                  boxShadow: `inset 0px 10px 22px rgba(255,255,255,0.9), inset 0px -6px 14px rgba(0,0,0,0.25)`
                }}>
                  {/* Gloss crescent at the top */}
                  <div style={{
                    position: "absolute", top: "3px", left: "5%", right: "5%", height: "48%",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 100%)",
                    borderRadius: "45px 45px 120px 120px", zIndex: 1, pointerEvents: "none"
                  }} />
                  
                  {/* Secondary extreme specular glare (the bright top-left curved dot) */}
                  <div style={{
                    position: "absolute", top: "8px", left: "18px", width: "35px", height: "16px",
                    background: "rgba(255,255,255,0.95)",
                    borderRadius: "50%", zIndex: 1, pointerEvents: "none", filter: "blur(2px)",
                    transform: "rotate(-18deg)"
                  }} />

                  {/* Main content (Icon + Text) */}
                  <div style={{ zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", marginTop: "14px" }}>
                    {/* The Icon container receives the specific dark inset color */}
                    <div style={{ color: btn.iconDark }}>
                      {btn.icon}
                    </div>
                    <span style={{
                      color: "white",
                      fontFamily: "'Arial Rounded MT Bold', 'Fredoka One', 'Nunito', 'Varela Round', sans-serif",
                      fontWeight: 900,
                      fontSize: "28px", // Juicier big text
                      lineHeight: "1.05",
                      textAlign: "center",
                      letterSpacing: "0.02em",
                      textShadow: "0px 4px 0px rgba(0,0,0,0.2), 0px 6px 12px rgba(0,0,0,0.45)",
                      whiteSpace: "pre-line"
                    }}>
                      {btn.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* About modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
    </div>
  );
}
