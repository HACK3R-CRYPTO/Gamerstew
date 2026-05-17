"use client";

// ─── /games/challenge-ai (hub) ────────────────────────────────────────────────
// Arena lobby — pick your MARKOV opponent. Each tier is a persona (Junior /
// Prime / Ω) with its own portrait, difficulty badge, voice line and payout
// multiplier. Tapping FIGHT does the transferAndCall and routes to the
// match page, which runs the VS / pick / reveal / result flow.
//
// Layout follows the claude.ai/design handoff in /tmp/design_extract — three
// opponent cards stacked on mobile, grid of three on desktop. Everything
// below the card grid (active matches, last battles, stat strip) is GameArena-
// specific context the design doesn't have.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { encodeAbiParameters, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC20_ABI } from "@/lib/contracts";
import {
  GAME_TYPES, WAGER_TIERS, MARKOV, MATCH_STATUS,
  type GameType, type WagerTier, type ArenaMatch,
} from "@/lib/challengeAi";

export default function ChallengeAiHubPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [game, setGame]   = useState<GameType>(GAME_TYPES[0]);
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Player's G$ balance — shown in the top bar so stakes feel real.
  const { data: gBalanceRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30000 },
  });
  const gBalance = gBalanceRaw != null
    ? parseFloat(formatUnits(gBalanceRaw as bigint, 18)).toFixed(2)
    : "—";

  // Match history — drives active matches + last battles strips.
  const { data: matchIds, refetch: refetchIds } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "getPlayerMatches",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12000 },
  });

  const [matches, setMatches] = useState<ArenaMatch[]>([]);
  useEffect(() => {
    if (!matchIds || !publicClient || (matchIds as readonly bigint[]).length === 0) {
      setMatches([]); return;
    }
    const ids = matchIds as readonly bigint[];
    let cancelled = false;
    (async () => {
      try {
        const results = await publicClient.multicall({
          contracts: ids.map(id => ({
            address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
            abi: ARENA_PLATFORM_ABI,
            functionName: "matches",
            args: [id],
          })),
        });
        if (cancelled) return;
        const parsed: ArenaMatch[] = results
          .map(r => {
            if (r.status !== "success" || !r.result) return null;
            const t = r.result as unknown as readonly [bigint, `0x${string}`, `0x${string}`, bigint, number, number, `0x${string}`, bigint];
            return {
              id: t[0], challenger: t[1], opponent: t[2], wager: t[3],
              gameType: t[4], status: t[5], winner: t[6], createdAt: t[7],
            };
          })
          .filter((m): m is ArenaMatch => m !== null)
          .sort((a, b) => Number(b.id - a.id));
        setMatches(parsed);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [matchIds, publicClient]);

  const active = useMemo(() => matches.filter(m =>
    m.status === MATCH_STATUS.ACCEPTED || m.status === MATCH_STATUS.PROPOSED
  ), [matches]);
  const recent = useMemo(() => matches.filter(m =>
    m.status === MATCH_STATUS.COMPLETED
  ).slice(0, 5), [matches]);

  // Win streak — consecutive recent wins before any loss.
  const winStreak = useMemo(() => {
    let s = 0;
    for (const m of recent) {
      if (!address) break;
      if (m.winner.toLowerCase() === address.toLowerCase()) s++;
      else break;
    }
    return s;
  }, [recent, address]);

  async function onChallenge(tier: WagerTier) {
    if (busyTier) return;
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    setBusyTier(tier.id); setError(null);
    try {
      const encoded = encodeAbiParameters(
        [{ type: "uint8" }, { type: "address" }, { type: "uint8" }],
        [0, CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`, game.id],
      );
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
        abi:          ERC20_ABI,
        functionName: "transferAndCall",
        args:         [CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, tier.amountWei, encoded],
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const log = receipt.logs.find(l =>
          l.address.toLowerCase() === (CONTRACT_ADDRESSES.ARENA_PLATFORM as string).toLowerCase()
          && l.topics.length >= 2,
        );
        const newId = log ? BigInt(log.topics[1]!) : null;
        if (newId) { router.push(`/games/challenge-ai/match/${newId}`); return; }
      }
      await refetchIds();
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Challenge failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setBusyTier(null);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#04001a",
      paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Arena floor — faded background, sets the "you're in the arena" vibe */}
      <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)",
          width: "min(140vw, 900px)", height: "min(140vw, 900px)", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.22) 0%, transparent 60%)",
          filter: "blur(40px)",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 560, margin: "0 auto",
        padding: "16px 14px 28px",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        {/* Top bar — back · streak · balance */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <CircleBtn label="←" onClick={() => router.push("/games")} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {winStreak >= 2 && <StreakChip streak={winStreak} />}
            <BalanceChip balance={gBalance} />
          </div>
        </div>

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 10px", borderRadius: 999,
            fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em",
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.35)",
            color: "#fbbf24",
          }}>🤖 PVE · CHALLENGE AI</div>
          <h1 style={{
            color: "white", fontSize: 30, fontWeight: 900,
            margin: "10px 0 4px",
            letterSpacing: "-0.01em",
            textShadow: "0 4px 20px rgba(167,139,250,0.4)",
          }}>Pick your opponent</h1>
          <p style={{
            color: "rgba(220,210,255,0.7)", fontSize: 12,
            margin: 0, maxWidth: 380, marginLeft: "auto", marginRight: "auto",
            lineHeight: 1.5,
          }}>
            Single round, on Celo. Harder MARKOV = bigger payout.{" "}
            <strong style={{ color: "#86efac" }}>You win all ties.</strong>
          </p>
        </div>

        {/* Game type — segmented */}
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(${GAME_TYPES.length}, 1fr)`, gap: 8,
          padding: 4, borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {GAME_TYPES.map(g => (
            <button key={g.id}
              onClick={() => setGame(g)}
              style={{
                padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                background: game.id === g.id
                  ? "linear-gradient(180deg, rgba(167,139,250,0.32) 0%, rgba(99,102,241,0.32) 100%)"
                  : "transparent",
                border: game.id === g.id ? "1px solid rgba(167,139,250,0.6)" : "1px solid transparent",
                color: game.id === g.id ? "white" : "rgba(220,210,255,0.7)",
                fontWeight: 900, fontSize: 12, letterSpacing: "0.08em",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
              <span style={{ fontSize: 16 }}>
                {g.moves[0].emoji}{g.moves[1] ? g.moves[1].emoji : ""}
              </span>
              {g.shortName}
            </button>
          ))}
        </div>

        {/* Opponent cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {WAGER_TIERS.map(tier => (
            <OpponentCard
              key={tier.id}
              tier={tier}
              game={game}
              busy={busyTier === tier.id}
              disabledByOther={!!busyTier && busyTier !== tier.id}
              onFight={() => onChallenge(tier)}
            />
          ))}
        </div>

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5", fontSize: 12, fontWeight: 700,
            textAlign: "center",
          }}>{error}</div>
        )}

        {/* Stat strip */}
        <div style={{
          display: "flex", gap: 14, justifyContent: "center",
          padding: "12px 16px", borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          alignSelf: "center",
        }}>
          <Stat label="Match" value="1 Round" />
          <Divider />
          <Stat label="Settles" value="~10s" />
          <Divider />
          <Stat label="Top payout" value="1.9×" />
        </div>

        {/* Active matches */}
        {active.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>UNFINISHED BATTLES</SectionLabel>
            {active.map(m => (
              <ActiveMatchRow key={String(m.id)} m={m} onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
            ))}
          </div>
        )}

        {/* Last battles */}
        {recent.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>YOUR LAST {recent.length} BATTLE{recent.length === 1 ? "" : "S"}</SectionLabel>
            {recent.map(m => (
              <BattleRow key={String(m.id)} m={m} address={address} onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
            ))}
          </div>
        )}

        <div style={{
          color: "rgba(200,180,255,0.42)",
          fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
          textAlign: "center", marginTop: 4, lineHeight: 1.5,
        }}>
          ERC-8004 verified · {MARKOV.name} settles every match on Celo · Wager goes to winner
        </div>
      </div>
    </div>
  );
}

// ─── OpponentCard — design-style lobby card ─────────────────────────────────
function OpponentCard({ tier, game, busy, disabledByOther, onFight }: {
  tier: WagerTier;
  game: GameType;
  busy: boolean;
  disabledByOther: boolean;
  onFight: () => void;
}) {
  return (
    <button
      onClick={busy || disabledByOther ? undefined : onFight}
      disabled={busy || disabledByOther}
      style={{
        position: "relative", overflow: "hidden",
        padding: 0, border: `1px solid ${tier.rim}55`, cursor: busy ? "wait" : disabledByOther ? "default" : "pointer",
        borderRadius: 22, textAlign: "left",
        background: `linear-gradient(180deg, ${tier.rim}22 0%, rgba(8,2,32,0.85) 60%)`,
        boxShadow: `0 16px 36px -10px ${tier.rim}66, inset 0 1px 0 rgba(255,255,255,0.1)`,
        minHeight: 168,
        display: "flex", flexDirection: "row", alignItems: "center",
        transition: "transform 0.15s, box-shadow 0.15s, opacity 0.15s",
        opacity: disabledByOther ? 0.45 : 1,
      }}
      onMouseEnter={e => {
        if (busy || disabledByOther) return;
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = `0 22px 44px -10px ${tier.rim}99, inset 0 1px 0 rgba(255,255,255,0.15)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = `0 16px 36px -10px ${tier.rim}66, inset 0 1px 0 rgba(255,255,255,0.1)`;
      }}
    >
      {/* Portrait disc */}
      <div style={{
        flexShrink: 0, width: 142, height: "100%",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 112, height: 112, borderRadius: "50%",
          background: tier.portraitBg,
          border: `2.5px solid ${tier.rim}`,
          boxShadow: `0 0 28px ${tier.rim}88, inset 0 -4px 16px rgba(0,0,0,0.3)`,
          overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: busy ? "pulse 1.2s ease-in-out infinite" : undefined,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tier.art} alt={tier.persona} style={{
            width: "125%", height: "125%", objectFit: "cover",
            filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
            mixBlendMode: "plus-lighter",
          }} />
        </div>

        {/* Difficulty badge */}
        <div style={{
          position: "absolute", top: 10, left: 10,
          padding: "4px 10px", borderRadius: 999,
          background: `${tier.rim}26`,
          border: `1px solid ${tier.rim}99`,
          fontSize: 9.5, color: tier.rim, fontWeight: 800, letterSpacing: "0.14em",
          backdropFilter: "blur(8px)",
        }}>{tier.difficulty}</div>
      </div>

      {/* Right column — name + title + desc + payout + FIGHT */}
      <div style={{ flex: 1, padding: "14px 14px 14px 4px" }}>
        <div style={{
          color: "white", fontSize: 19, fontWeight: 900, lineHeight: 1,
          letterSpacing: "0.01em",
        }}>{tier.persona}</div>
        <div style={{
          color: tier.rim, fontSize: 10.5, fontWeight: 800,
          letterSpacing: "0.14em", marginTop: 4,
        }}>{tier.title.toUpperCase()}</div>
        <div style={{
          color: "rgba(220,210,255,0.7)", fontSize: 11.5,
          lineHeight: 1.4, marginTop: 9,
        }}>{tier.lines.ready}</div>

        {/* Prize + FIGHT CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 10px 6px 8px", borderRadius: 10,
            background: "linear-gradient(180deg, rgba(251,191,36,0.18), rgba(251,191,36,0.06))",
            border: "1px solid rgba(251,191,36,0.5)",
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: 999,
              background: "radial-gradient(circle at 35% 35%, #fde68a, #b45309)",
            }} />
            <span style={{ color: "#fde68a", fontSize: 12.5, fontWeight: 900 }}>
              {tier.amount} G$
            </span>
          </div>
          <span style={{
            flex: 1, color: "rgba(220,210,255,0.45)",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
          }}>{game.shortName} · winner takes pot</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 12px", borderRadius: 10,
            background: tier.rim, color: "#04001a",
            fontSize: 11.5, fontWeight: 900, letterSpacing: "0.08em",
            boxShadow: `0 6px 14px -3px ${tier.rim}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
          }}>
            {busy ? "..." : "▶ FIGHT"}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Small UI bits ───────────────────────────────────────────────────────────
function CircleBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36, height: 36, borderRadius: 999,
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(6px)",
      }}
    >{label}</button>
  );
}

function StreakChip({ streak }: { streak: number }) {
  return (
    <div style={{
      padding: "5px 11px", borderRadius: 999,
      background: "rgba(251,191,36,0.16)",
      border: "1px solid rgba(251,191,36,0.5)",
      display: "flex", alignItems: "center", gap: 5,
      boxShadow: "0 0 12px rgba(251,191,36,0.35)",
    }}>
      <span style={{ fontSize: 13 }}>🔥</span>
      <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>{streak}</span>
    </div>
  );
}

function BalanceChip({ balance }: { balance: string }) {
  return (
    <div style={{
      padding: "5px 11px", borderRadius: 999,
      background: "rgba(134,239,172,0.12)",
      border: "1px solid rgba(134,239,172,0.4)",
      display: "flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ color: "rgba(134,239,172,0.8)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>G$</span>
      <span style={{ color: "#86efac", fontSize: 12, fontWeight: 900, fontFamily: "monospace" }}>{balance}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: "rgba(229,231,235,0.55)", fontSize: 10, fontWeight: 900,
      letterSpacing: "0.18em",
    }}>{children}</div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "white", fontSize: 16, fontWeight: 900, lineHeight: 1, letterSpacing: "0.01em" }}>{value}</span>
      <span style={{ color: "rgba(220,210,255,0.45)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />;
}

function ActiveMatchRow({ m, onOpen }: { m: ArenaMatch; onOpen: () => void }) {
  const isYourTurn = m.status === MATCH_STATUS.ACCEPTED;
  const wager = Number(formatUnits(m.wager, 18)).toFixed(2);
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter") onOpen(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 12,
        background: isYourTurn ? "rgba(251,191,36,0.12)" : "rgba(167,139,250,0.08)",
        border: isYourTurn ? "1.5px solid rgba(251,191,36,0.5)" : "1px solid rgba(167,139,250,0.3)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ color: "white", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em" }}>
          #{String(m.id)} · {wager} G$ · {m.gameType === 0 ? "RPS" : "COIN"}
        </div>
        <div style={{
          color: isYourTurn ? "#fbbf24" : "rgba(216,180,254,0.85)",
          fontSize: 9, fontWeight: 800, letterSpacing: "0.18em",
        }}>{isYourTurn ? "▶ YOUR MOVE" : "WAITING FOR MARKOV-1"}</div>
      </div>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 18, fontWeight: 900 }}>→</div>
    </div>
  );
}

function BattleRow({ m, address, onOpen }: { m: ArenaMatch; address?: string; onOpen: () => void }) {
  const youWon = !!address && m.winner.toLowerCase() === address.toLowerCase();
  const wager = Number(formatUnits(m.wager, 18)).toFixed(2);
  const gameLabel = m.gameType === 0 ? "RPS" : "COIN";
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter") onOpen(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 12,
        background: youWon ? "rgba(134,239,172,0.06)" : "rgba(239,68,68,0.05)",
        border: youWon ? "1px solid rgba(134,239,172,0.25)" : "1px solid rgba(239,68,68,0.2)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em" }}>
          #{String(m.id)} · {gameLabel}
        </div>
        <div style={{
          color: youWon ? "#86efac" : "#fca5a5",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
        }}>{youWon ? `+${(parseFloat(wager) * 1.9).toFixed(2)} G$ · YOU WON` : `−${wager} G$ · MARKOV WON`}</div>
      </div>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: 900 }}>›</div>
    </div>
  );
}
