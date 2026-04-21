"use client";

// ─── /pitch ───────────────────────────────────────────────────────────────────
// Live pitch deck for Game Arena. Shareable URL, keyboard + swipe navigation,
// full-screen friendly. Designed to be presented on a phone, laptop, or
// projector. Kept in-repo so the deck stays in sync with the product as it
// ships — no stale Canva exports to maintain.
//
// Controls:
//   • → / Space / click next-arrow → advance
//   • ← → previous
//   • F → full-screen toggle
//   • Swipe left / right on touch
//
// Intentionally minimal — no external slide library. A slide is a plain
// JSX element in the SLIDES array. Brand colors + Melon Pop font are
// inherited from globals.css so every slide feels consonant with the app.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";

// Brand palette references so every slide feels part of the app
const GOLD = "#fbbf24";
const MAGENTA = "#c026d3";
const ROYAL = "#6a18c8";
const GREEN = "#22c55e";
const CYAN = "#06b6d4";

// ─── Reusable slide primitives ─────────────────────────────────────────────────

function SlideFrame({ children, eyebrow }: { children: React.ReactNode; eyebrow?: string }) {
  return (
    <div style={{
      position: "relative",
      width: "100%", height: "100%",
      display: "flex", flexDirection: "column",
      padding: "clamp(24px, 6vh, 64px) clamp(20px, 6vw, 80px)",
      boxSizing: "border-box",
      overflow: "hidden",
    }}>
      {eyebrow && (
        <div style={{
          color: GOLD,
          fontSize: "clamp(10px, 1.4vw, 13px)",
          fontWeight: 900, letterSpacing: "0.4em",
          textShadow: `0 0 16px ${GOLD}aa`,
          marginBottom: "clamp(12px, 2vh, 28px)",
        }}>{eyebrow}</div>
      )}
      {children}
    </div>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 style={{
      margin: 0,
      color: "white",
      fontSize: "clamp(32px, 6vw, 72px)",
      fontWeight: 900, lineHeight: 1.05,
      letterSpacing: "0.01em",
      textShadow: `0 0 20px ${GOLD}55, 0 4px 12px rgba(0,0,0,0.7)`,
    }}>{children}</h1>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      margin: 0,
      color: "white",
      fontSize: "clamp(22px, 4vw, 44px)",
      fontWeight: 900, lineHeight: 1.1,
    }}>{children}</h2>
  );
}

function Lead({ children, color = "rgba(255,255,255,0.88)" }: { children: React.ReactNode; color?: string }) {
  return (
    <p style={{
      color,
      fontSize: "clamp(15px, 2.2vw, 22px)",
      lineHeight: 1.55,
      margin: "clamp(10px, 2vh, 20px) 0",
      maxWidth: "960px",
    }}>{children}</p>
  );
}

function Bullet({ children, accent = MAGENTA }: { children: React.ReactNode; accent?: string }) {
  return (
    <li style={{
      display: "flex", gap: "12px",
      color: "rgba(255,255,255,0.88)",
      fontSize: "clamp(14px, 1.8vw, 20px)",
      lineHeight: 1.5,
      padding: "6px 0",
    }}>
      <span style={{
        flexShrink: 0,
        width: "10px", height: "10px",
        borderRadius: "50%",
        background: accent,
        boxShadow: `0 0 12px ${accent}`,
        marginTop: "10px",
      }} />
      <span>{children}</span>
    </li>
  );
}

function BulletList({ children }: { children: React.ReactNode }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: "900px" }}>
      {children}
    </ul>
  );
}

// Big stat tile used on the "how it works" slide
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{
      display: "flex", gap: "clamp(14px, 2vw, 22px)", alignItems: "flex-start",
      padding: "clamp(10px, 1.5vh, 16px) 0",
    }}>
      <div style={{
        flexShrink: 0,
        width: "clamp(36px, 4vw, 54px)",
        height: "clamp(36px, 4vw, 54px)",
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, ${GOLD}, ${MAGENTA} 75%)`,
        border: `2px solid rgba(255,255,255,0.5)`,
        boxShadow: `0 0 18px ${GOLD}66, inset 0 2px 6px rgba(255,255,255,0.4)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "white",
        fontSize: "clamp(14px, 2vw, 20px)",
        fontWeight: 900,
        textShadow: "0 1px 3px rgba(0,0,0,0.7)",
      }}>{n}</div>
      <div>
        <div style={{
          color: "white",
          fontSize: "clamp(15px, 2vw, 22px)",
          fontWeight: 900,
          letterSpacing: "0.04em",
        }}>{title}</div>
        <div style={{
          color: "rgba(200,180,255,0.78)",
          fontSize: "clamp(13px, 1.6vw, 17px)",
          marginTop: "4px",
          lineHeight: 1.5,
        }}>{body}</div>
      </div>
    </div>
  );
}

// Play-now slide renders a QR code to the live app. Generated at mount
// so we never ship a stale PNG; link is the single source of truth.
function PlayNowSlide() {
  const URL = "https://gamearenahq.xyz/";
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(URL, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 720,
      color: { dark: "#0a0120", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch(() => {});
  }, []);

  return (
    <SlideFrame eyebrow="PLAY NOW">
      <H1>Scan. Play. Win 1.3x.</H1>
      <div style={{
        marginTop: "clamp(20px, 4vh, 48px)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "clamp(24px, 4vw, 56px)",
      }}>
        {/* QR tile with a gold border so it reads as a target, not decor */}
        <div style={{
          padding: "clamp(14px, 2vh, 22px)",
          borderRadius: "24px",
          background: "white",
          boxShadow: `0 0 0 4px ${GOLD}, 0 0 60px ${GOLD}66, 0 20px 50px rgba(0,0,0,0.6)`,
        }}>
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt="QR code for gamearenahq.xyz"
              style={{
                display: "block",
                width: "clamp(220px, 28vw, 360px)",
                height: "clamp(220px, 28vw, 360px)",
              }}
            />
          ) : (
            <div style={{
              width: "clamp(220px, 28vw, 360px)",
              height: "clamp(220px, 28vw, 360px)",
              background: "#eee",
            }} />
          )}
        </div>

        <div style={{ maxWidth: "460px" }}>
          <div style={{
            color: GOLD,
            fontSize: "clamp(18px, 2.4vw, 26px)",
            fontWeight: 900,
            letterSpacing: "0.08em",
            textShadow: `0 0 16px ${GOLD}aa`,
          }}>
            gamearenahq.xyz
          </div>
          <ul style={{
            listStyle: "none", padding: 0,
            margin: "clamp(14px, 2vh, 22px) 0 0",
            color: "rgba(230,220,255,0.9)",
            fontSize: "clamp(14px, 1.7vw, 18px)",
            lineHeight: 1.55,
          }}>
            <li>Point your camera at the code.</li>
            <li>Sign in with Google in 10 seconds.</li>
            <li>Claim G$. Play Rhythm or Simon.</li>
            <li>Every wager funds real UBI.</li>
          </ul>
          <a href={URL} target="_blank" rel="noreferrer"
            style={{
              display: "inline-block",
              marginTop: "clamp(16px, 2.4vh, 26px)",
              padding: "clamp(10px, 1.4vh, 14px) clamp(20px, 2.6vw, 32px)",
              borderRadius: "999px",
              background: `linear-gradient(160deg, ${GREEN} 0%, #15803d 100%)`,
              border: "2px solid rgba(255,255,255,0.5)",
              color: "white",
              fontWeight: 900,
              fontSize: "clamp(13px, 1.7vw, 16px)",
              letterSpacing: "0.1em",
              textDecoration: "none",
              boxShadow: "0 0 24px rgba(34,197,94,0.5), inset 0 4px 10px rgba(255,255,255,0.4)",
            }}>
            OPEN LINK
          </a>
        </div>
      </div>
    </SlideFrame>
  );
}

// Traction slide pulls live numbers from the backend so the deck is always
// honest about where we are. Falls back gracefully if the API is down.
function TractionSlide() {
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";
  const [stats, setStats] = useState<{
    totalUsers: number; totalGames: number; totalWagered: string;
    rhythmPlayers: number; simonPlayers: number;
    topRhythm: number; topSimon: number;
    estimatedPrizePot: string;
  } | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, [BACKEND_URL]);

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  const tiles = [
    { label: "PLAYERS", value: stats ? fmt(stats.totalUsers) : "…", c: GOLD },
    { label: "GAMES PLAYED", value: stats ? fmt(stats.totalGames) : "…", c: MAGENTA },
    { label: "G$ WAGERED", value: stats ? `${Number(stats.totalWagered).toFixed(0)}` : "…", c: GREEN },
    { label: "PRIZE POT", value: stats ? `${Number(stats.estimatedPrizePot).toFixed(2)} G$` : "…", c: CYAN },
  ];

  return (
    <SlideFrame eyebrow="TRACTION">
      <H1>People are playing. Every score hits the chain.</H1>
      <div style={{
        marginTop: "clamp(20px, 3vh, 40px)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "clamp(14px, 2vw, 22px)",
        maxWidth: "1200px",
      }}>
        {tiles.map((s, i) => (
          <div key={i} style={{
            borderRadius: "18px",
            background: "linear-gradient(180deg, rgba(20,10,50,0.8), rgba(6,1,24,0.9))",
            border: `2px solid ${s.c}`,
            boxShadow: `0 0 22px ${s.c}44`,
            padding: "clamp(16px, 2.4vh, 24px)",
            textAlign: "center",
          }}>
            <div style={{
              color: s.c,
              fontSize: "clamp(32px, 5vw, 56px)",
              fontWeight: 900, lineHeight: 1,
              textShadow: `0 0 18px ${s.c}`,
            }}>{s.value}</div>
            <div style={{
              color: "rgba(200,180,255,0.7)",
              fontSize: "clamp(10px, 1.2vw, 12px)",
              fontWeight: 800,
              letterSpacing: "0.16em",
              marginTop: "8px",
            }}>{s.label}</div>
          </div>
        ))}
      </div>
      <Lead>
        Two games live on Celo mainnet. One signed score rail. Every wager funds UBI. These numbers are live, pulled as you read this.
      </Lead>
      {stats && (
        <div style={{
          marginTop: "clamp(10px, 1.6vh, 18px)",
          color: "rgba(200,180,255,0.65)",
          fontSize: "clamp(12px, 1.3vw, 15px)",
          fontWeight: 600,
        }}>
          Top Rhythm score: <strong style={{ color: GOLD }}>{stats.topRhythm}</strong>
          {" · "}
          Top Simon score: <strong style={{ color: CYAN }}>{stats.topSimon}</strong>
        </div>
      )}
    </SlideFrame>
  );
}

// ─── Slide content ────────────────────────────────────────────────────────────

const SLIDES: { key: string; render: () => React.ReactNode }[] = [
  // 1. COVER
  {
    key: "cover",
    render: () => (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "40px", textAlign: "center",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/components/game_arena_text.png"
          alt="Game Arena"
          style={{
            width: "clamp(260px, 55vw, 640px)",
            filter: `drop-shadow(0 0 30px ${GOLD}66) drop-shadow(0 0 60px ${MAGENTA}44)`,
          }}
        />
        <div style={{
          marginTop: "clamp(20px, 4vh, 40px)",
          color: "rgba(254,215,170,0.95)",
          fontSize: "clamp(16px, 3vw, 28px)",
          fontWeight: 800,
          letterSpacing: "0.14em",
          textShadow: "0 0 16px rgba(251,191,36,0.6)",
        }}>
          SKILL GAMES · REAL REWARDS · FUNDED UBI
        </div>
        <div style={{
          marginTop: "clamp(24px, 5vh, 44px)",
          color: "rgba(200,180,255,0.65)",
          fontSize: "clamp(12px, 1.5vw, 16px)",
          fontWeight: 700,
          letterSpacing: "0.2em",
        }}>
          CELO · GOODDOLLAR · MINIPAY
        </div>
      </div>
    ),
  },

  // 2. PROBLEM
  {
    key: "problem",
    render: () => (
      <SlideFrame eyebrow="THE PROBLEM">
        <H1>Web3 games fail you.</H1>
        <div style={{ height: "clamp(12px, 2vh, 28px)" }} />
        <BulletList>
          <Bullet accent="#ef4444">
            <strong>You pay to play.</strong> 95% of new players quit at the paywall.
          </Bullet>
          <Bullet accent="#f97316">
            <strong>Loot boxes win, skill loses.</strong> Real skill games sit on app stores. They cannot settle real money.
          </Bullet>
          <Bullet accent="#fbbf24">
            <strong>The economy extracts.</strong> Value goes to early token holders, not players.
          </Bullet>
        </BulletList>
      </SlideFrame>
    ),
  },

  // 3. SOLUTION
  {
    key: "solution",
    render: () => (
      <SlideFrame eyebrow="THE SOLUTION">
        <H1>Free tokens. Real skill. Real UBI.</H1>
        <Lead>
          Scan your face once. Claim <strong style={{ color: GREEN }}>G$</strong> every 24 hours. Wager it on a 30 second skill round. Win <strong style={{ color: GOLD }}>1.3x</strong>. Every wager funds GoodDollar UBI for 500,000 verified humans.
        </Lead>
        <div style={{
          marginTop: "clamp(16px, 3vh, 32px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "clamp(12px, 1.6vw, 22px)",
          maxWidth: "1100px",
        }}>
          {[
            { icon: "💰", title: "Claim free G$", body: "No purchase. No deposit.", c: GREEN },
            { icon: "🎮", title: "Wager skill", body: "Win 1.3x on Rhythm or Simon.", c: GOLD },
            { icon: "🌍", title: "Fund UBI", body: "Every wager goes to GoodDollar.", c: CYAN },
          ].map((card, i) => (
            <div key={i} style={{
              borderRadius: "16px",
              background: `linear-gradient(180deg, ${card.c}22 0%, rgba(0,0,0,0.3) 100%)`,
              border: `1.5px solid ${card.c}`,
              padding: "clamp(14px, 2vh, 22px)",
            }}>
              <div style={{ fontSize: "clamp(28px, 3.5vw, 42px)" }}>{card.icon}</div>
              <div style={{
                color: "white", fontWeight: 900,
                fontSize: "clamp(14px, 1.8vw, 18px)",
                marginTop: "8px",
              }}>{card.title}</div>
              <div style={{
                color: "rgba(200,180,255,0.75)",
                fontSize: "clamp(12px, 1.4vw, 14px)",
                marginTop: "4px", lineHeight: 1.4,
              }}>{card.body}</div>
            </div>
          ))}
        </div>
      </SlideFrame>
    ),
  },

  // 4. PRODUCT: THE GAMES
  {
    key: "games",
    render: () => (
      <SlideFrame eyebrow="THE PRODUCT">
        <H1>Two games live. More on the rail.</H1>
        <div style={{
          marginTop: "clamp(16px, 3vh, 32px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "clamp(16px, 2vw, 24px)",
          maxWidth: "1100px",
        }}>
          {[
            {
              name: "RHYTHM RUSH", icon: "🥁", accent: MAGENTA,
              body: "30 second track. Four lanes. Tap the beat. Keep your combo to unlock ENCORE, a three life survival mode.",
            },
            {
              name: "SIMON MEMORY", icon: "🧠", accent: CYAN,
              body: "Four pads. Repeat the sequence. Round 5 adds a fifth pad. No score cap. Difficulty keeps scaling.",
            },
            {
              name: "NEXT UP", icon: "⚡", accent: GOLD,
              body: "Challenge AI for head to head runs. The Arena model drops new titles into the same economy and leaderboards.",
            },
          ].map((g, i) => (
            <div key={i} style={{
              borderRadius: "18px",
              background: "linear-gradient(180deg, #230d6b 0%, #0e0535 60%, #060118 100%)",
              border: `2px solid ${g.accent}`,
              boxShadow: `0 0 24px ${g.accent}33`,
              padding: "clamp(16px, 2.4vh, 22px)",
            }}>
              <div style={{ fontSize: "clamp(30px, 4vw, 48px)" }}>{g.icon}</div>
              <div style={{
                color: "white", fontWeight: 900,
                fontSize: "clamp(16px, 2vw, 22px)",
                letterSpacing: "0.06em",
                marginTop: "clamp(8px, 1vh, 12px)",
                textShadow: `0 0 14px ${g.accent}99`,
              }}>{g.name}</div>
              <div style={{
                color: "rgba(200,180,255,0.82)",
                fontSize: "clamp(12.5px, 1.5vw, 15px)",
                marginTop: "8px", lineHeight: 1.5,
              }}>{g.body}</div>
            </div>
          ))}
        </div>
      </SlideFrame>
    ),
  },

  // 5. USER JOURNEY
  {
    key: "journey",
    render: () => (
      <SlideFrame eyebrow="USER JOURNEY">
        <H1>Set up once. Play forever.</H1>
        <div style={{ height: "clamp(12px, 2vh, 24px)" }} />
        <Step n={1} title="Connect" body="Google, email, or wallet. 10 seconds. No seed phrase." />
        <Step n={2} title="Mint Game Pass" body="Soulbound NFT with your username. Free. Pay a few cents of CELO for gas." />
        <Step n={3} title="Verify" body="One GoodDollar face scan. Unlocks claims, wagering, and leaderboards." />
        <Step n={4} title="Claim daily" body="Free G$ every 24 hours. Tap to claim." />
        <Step n={5} title="Play and progress" body="Earn XP. Level up. Evolve your pet. Climb tiers. Unlock badges." />
      </SlideFrame>
    ),
  },

  // 6. THE ECONOMY
  {
    key: "economy",
    render: () => (
      <SlideFrame eyebrow="THE ECONOMY">
        <H1>Free. Real. Yours.</H1>
        <BulletList>
          <Bullet accent={GREEN}>
            <strong>G$ is real.</strong> Live ERC 20 on Celo. Market value. Works across GoodDollar.
          </Bullet>
          <Bullet accent={GOLD}>
            <strong>You claim it.</strong> Same daily allocation for every verified human. No presale. No vesting.
          </Bullet>
          <Bullet accent={MAGENTA}>
            <strong>Win 1.3x.</strong> Losses feed the weekly prize pool. That pool feeds UBI.
          </Bullet>
          <Bullet accent={CYAN}>
            <strong>No gambling risk.</strong> You stake earned in game currency. Skill reward, not wagering.
          </Bullet>
        </BulletList>
      </SlideFrame>
    ),
  },

  // 7. RETENTION STACK
  {
    key: "retention",
    render: () => (
      <SlideFrame eyebrow="RETENTION">
        <H1>Six loops that keep you coming back.</H1>
        <div style={{
          marginTop: "clamp(16px, 2vh, 28px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "clamp(10px, 1.4vw, 18px)",
          maxWidth: "1180px",
        }}>
          {[
            { icon: "📊", title: "XP and Levels", body: "Every game earns XP. No cap.", c: GOLD },
            { icon: "🐣", title: "Pet Evolution", body: "5 stages. Egg to King Slime.", c: GREEN },
            { icon: "🏆", title: "Rank Tiers", body: "Bronze to Master. Updates weekly.", c: MAGENTA },
            { icon: "🎯", title: "Daily Missions", body: "3 missions. Refresh every 24h.", c: "#f97316" },
            { icon: "🔥", title: "Streaks", body: "Skip a day, your flame freezes. Play to thaw.", c: CYAN },
            { icon: "✦", title: "Achievements", body: "13 milestones. NFT badges ship next.", c: "#f472b6" },
          ].map((loop, i) => (
            <div key={i} style={{
              borderRadius: "14px",
              background: "rgba(20,10,50,0.6)",
              border: `1.5px solid ${loop.c}66`,
              padding: "clamp(10px, 1.4vh, 14px)",
              boxShadow: `0 0 16px ${loop.c}22`,
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
              }}>
                <span style={{ fontSize: "clamp(20px, 2.4vw, 26px)" }}>{loop.icon}</span>
                <span style={{
                  color: "white", fontWeight: 900,
                  fontSize: "clamp(13px, 1.6vw, 16px)",
                  letterSpacing: "0.04em",
                }}>{loop.title}</span>
              </div>
              <div style={{
                color: "rgba(200,180,255,0.75)",
                fontSize: "clamp(11.5px, 1.35vw, 13.5px)",
                marginTop: "6px", lineHeight: 1.45,
              }}>{loop.body}</div>
            </div>
          ))}
        </div>
      </SlideFrame>
    ),
  },

  // 8. DISTRIBUTION
  {
    key: "distribution",
    render: () => (
      <SlideFrame eyebrow="DISTRIBUTION">
        <H1>Players are already here.</H1>
        <BulletList>
          <Bullet accent={GREEN}>
            <strong>MiniPay.</strong> 4M monthly actives across Africa, LatAm, and South Asia. Game Arena runs inside it.
          </Bullet>
          <Bullet accent={GOLD}>
            <strong>Celo mainnet.</strong> $0.001 per transaction. No gas wall.
          </Bullet>
          <Bullet accent={MAGENTA}>
            <strong>Web, not app store.</strong> Share a link. It opens. Updates ship instantly.
          </Bullet>
          <Bullet accent={CYAN}>
            <strong>Social login.</strong> 60% of our base has never used a wallet. Google or email gets them playing in 10 seconds.
          </Bullet>
        </BulletList>
      </SlideFrame>
    ),
  },

  // 9. TRACTION (live numbers from /api/stats)
  {
    key: "traction",
    render: () => <TractionSlide />,
  },

  // 10. TECH & TRUST
  {
    key: "tech",
    render: () => (
      <SlideFrame eyebrow="TECH AND TRUST">
        <H1>Every score is on chain.</H1>
        <BulletList>
          <Bullet accent={GOLD}>
            <strong>Celo mainnet.</strong> Scores, wagers, and badges are on chain and auditable.
          </Bullet>
          <Bullet accent={GREEN}>
            <strong>Signed scores.</strong> EIP 712 vouchers. Backend signs, wallet countersigns. Neither side can post a score alone.
          </Bullet>
          <Bullet accent={MAGENTA}>
            <strong>Soulbound Game Pass.</strong> One per human. No transfers. No bot secondary market.
          </Bullet>
          <Bullet accent={CYAN}>
            <strong>Face scan.</strong> GoodDollar Sybil resistance at the identity layer.
          </Bullet>
          <Bullet accent="#f472b6">
            <strong>Canvas and Web Audio.</strong> No MP3 bandwidth. No licensing risk.
          </Bullet>
        </BulletList>
      </SlideFrame>
    ),
  },

  // 11. ROADMAP
  {
    key: "roadmap",
    render: () => (
      <SlideFrame eyebrow="ROADMAP">
        <H1>What you get. What is next.</H1>
        <div style={{
          marginTop: "clamp(18px, 3vh, 30px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "clamp(14px, 2vw, 22px)",
          maxWidth: "1200px",
        }}>
          {[
            {
              label: "SHIPPED",
              c: GREEN,
              items: [
                "Rhythm Rush and Simon Memory live",
                "G$ wagering with on chain settlement",
                "Game Pass and username mint",
                "Weekly seasons and 3 Week Cup",
                "6 loop progression stack",
                "MiniPay and Privy auth",
              ],
            },
            {
              label: "NEXT",
              c: GOLD,
              items: [
                "Challenge AI head to head",
                "Achievement NFT badge mint",
                "Tournament brackets",
                "Third skill game",
              ],
            },
            {
              label: "HORIZON",
              c: MAGENTA,
              items: [
                "Signed oracle anti cheat at scale",
                "Public API for third party games",
                "Native shells for app stores",
              ],
            },
          ].map((col, i) => (
            <div key={i} style={{
              borderRadius: "18px",
              background: "linear-gradient(180deg, rgba(20,10,50,0.8), rgba(6,1,24,0.95))",
              border: `1.5px solid ${col.c}`,
              padding: "clamp(16px, 2.4vh, 22px)",
              boxShadow: `0 0 22px ${col.c}33`,
            }}>
              <div style={{
                color: col.c,
                fontSize: "clamp(13px, 1.6vw, 16px)",
                fontWeight: 900,
                letterSpacing: "0.22em",
                textShadow: `0 0 14px ${col.c}aa`,
                marginBottom: "clamp(10px, 1.6vh, 16px)",
              }}>{col.label}</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {col.items.map((item, j) => (
                  <li key={j} style={{
                    color: "rgba(255,255,255,0.85)",
                    fontSize: "clamp(12.5px, 1.55vw, 15px)",
                    lineHeight: 1.5,
                    padding: "4px 0",
                    borderLeft: `2px solid ${col.c}66`,
                    paddingLeft: "10px",
                    marginBottom: "6px",
                  }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </SlideFrame>
    ),
  },

  // 12. ASK + CONTACT
  {
    key: "ask",
    render: () => (
      <SlideFrame eyebrow="THE ASK">
        <H1>Build the arena with us.</H1>
        <Lead>
          Three lanes. Pick the one that fits you.
        </Lead>
        <div style={{
          marginTop: "clamp(14px, 2vh, 22px)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "clamp(14px, 1.8vw, 22px)",
          maxWidth: "1100px",
        }}>
          {[
            { c: GREEN, title: "Funding", body: "Pre seed. Tournaments, a third game, and a two engineer team for 12 months." },
            { c: GOLD, title: "Distribution", body: "MiniPay dapp store, Celo Foundation intros, wallet integrations." },
            { c: MAGENTA, title: "Partnership", body: "Skill game studios who want an on chain economy and UBI rail." },
          ].map((a, i) => (
            <div key={i} style={{
              borderRadius: "18px",
              background: `linear-gradient(180deg, ${a.c}22 0%, rgba(0,0,0,0.35) 100%)`,
              border: `1.5px solid ${a.c}`,
              padding: "clamp(14px, 2vh, 20px)",
            }}>
              <div style={{
                color: "white", fontWeight: 900,
                fontSize: "clamp(16px, 2vw, 22px)",
                textShadow: `0 0 14px ${a.c}aa`,
              }}>{a.title}</div>
              <div style={{
                color: "rgba(200,180,255,0.82)",
                fontSize: "clamp(12.5px, 1.5vw, 15px)",
                marginTop: "8px", lineHeight: 1.5,
              }}>{a.body}</div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: "clamp(22px, 4vh, 40px)",
          display: "flex", flexWrap: "wrap", gap: "clamp(10px, 1.5vw, 16px)",
          alignItems: "center",
        }}>
          <a href="https://gamearenahq.xyz" target="_blank" rel="noreferrer"
            style={{
              padding: "clamp(10px, 1.4vh, 14px) clamp(18px, 2.4vw, 28px)",
              borderRadius: "999px",
              background: `linear-gradient(160deg, ${GREEN} 0%, #15803d 100%)`,
              border: "2px solid rgba(255,255,255,0.5)",
              color: "white", fontWeight: 900,
              fontSize: "clamp(13px, 1.7vw, 16px)",
              letterSpacing: "0.1em",
              textDecoration: "none",
              boxShadow: "0 0 24px rgba(34,197,94,0.5), inset 0 4px 10px rgba(255,255,255,0.4)",
            }}>
            PLAY NOW →
          </a>
          <a href="https://t.me/+oY4inbBoglViNmE0" target="_blank" rel="noreferrer"
            style={{
              padding: "clamp(10px, 1.4vh, 14px) clamp(18px, 2.4vw, 28px)",
              borderRadius: "999px",
              background: "rgba(20,10,50,0.6)",
              border: `1.5px solid ${CYAN}`,
              color: "white", fontWeight: 800,
              fontSize: "clamp(13px, 1.7vw, 16px)",
              letterSpacing: "0.08em",
              textDecoration: "none",
            }}>
            TELEGRAM
          </a>
          <span style={{
            color: "rgba(200,180,255,0.6)",
            fontSize: "clamp(11px, 1.3vw, 13px)",
            fontFamily: "monospace",
          }}>gamearenahq.xyz</span>
        </div>
      </SlideFrame>
    ),
  },

  // 13. PLAY NOW (QR)
  {
    key: "play",
    render: () => <PlayNowSlide />,
  },
];

// ─── The deck shell ───────────────────────────────────────────────────────────

export default function PitchDeckPage() {
  const [i, setI] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  const total = SLIDES.length;
  const go = (delta: number) => setI(n => Math.max(0, Math.min(total - 1, n + delta)));
  const goTo = (n: number) => setI(Math.max(0, Math.min(total - 1, n)));

  // Keyboard navigation — arrow keys, space, f for fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "Home") { e.preventDefault(); setI(0); }
      else if (e.key === "End") { e.preventDefault(); setI(total - 1); }
      else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else containerRef.current?.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  const slide = SLIDES[i];

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: "fixed", inset: 0, overflow: "hidden",
        background: `radial-gradient(ellipse 80% 60% at 50% 15%, ${ROYAL} 0%, #3b0a9e 30%, #1a044a 60%, #0a0120 100%)`,
        fontFamily: "inherit",
      }}
    >
      {/* Vignette */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 50%, transparent 35%, rgba(5,1,20,0.55) 100%)",
      }} />

      {/* Slide */}
      <div key={slide.key} style={{
        position: "absolute", inset: 0,
        animation: "fadeIn 0.35s ease both",
      }}>
        {slide.render()}
      </div>

      {/* Prev / Next arrows — desktop only, hidden on touch */}
      {i > 0 && (
        <button
          onClick={() => go(-1)}
          aria-label="Previous slide"
          style={{
            position: "absolute", top: "50%", left: "clamp(8px, 2vw, 24px)",
            transform: "translateY(-50%)",
            width: "44px", height: "44px",
            borderRadius: "50%",
            background: "rgba(20,10,50,0.7)",
            border: `1.5px solid ${GOLD}55`,
            color: "white", fontSize: "20px", fontWeight: 900,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
        >‹</button>
      )}
      {i < total - 1 && (
        <button
          onClick={() => go(1)}
          aria-label="Next slide"
          style={{
            position: "absolute", top: "50%", right: "clamp(8px, 2vw, 24px)",
            transform: "translateY(-50%)",
            width: "44px", height: "44px",
            borderRadius: "50%",
            background: "rgba(20,10,50,0.7)",
            border: `1.5px solid ${GOLD}55`,
            color: "white", fontSize: "20px", fontWeight: 900,
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
        >›</button>
      )}

      {/* Progress dots + slide counter */}
      <div style={{
        position: "absolute", bottom: "clamp(14px, 2.4vh, 24px)", left: 0, right: 0,
        display: "flex", justifyContent: "center", gap: "6px",
        pointerEvents: "none",
      }}>
        {SLIDES.map((_, idx) => (
          <button
            key={idx}
            onClick={() => goTo(idx)}
            aria-label={`Go to slide ${idx + 1}`}
            style={{
              pointerEvents: "auto",
              width: idx === i ? "24px" : "8px",
              height: "8px",
              borderRadius: "999px",
              background: idx === i ? GOLD : "rgba(255,255,255,0.25)",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: idx === i ? `0 0 12px ${GOLD}` : "none",
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* Slide counter + hint */}
      <div style={{
        position: "absolute", top: "clamp(12px, 2vh, 20px)", right: "clamp(12px, 2vw, 24px)",
        color: "rgba(200,180,255,0.45)",
        fontSize: "clamp(10px, 1.2vw, 12px)",
        fontWeight: 800,
        letterSpacing: "0.14em",
      }}>
        {String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </div>

      {/* Back to app — top-left */}
      <Link href="/home" style={{
        position: "absolute", top: "clamp(12px, 2vh, 20px)", left: "clamp(12px, 2vw, 24px)",
        color: "rgba(200,180,255,0.55)",
        fontSize: "clamp(10px, 1.2vw, 12px)",
        fontWeight: 700,
        letterSpacing: "0.14em",
        textDecoration: "none",
      }}>← APP</Link>
    </div>
  );
}
