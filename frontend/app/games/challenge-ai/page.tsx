"use client";

// ─── /games/challenge-ai (hub) ────────────────────────────────────────────────
// Entry point for the Challenge AI game mode. Player picks:
//   1. Game type — RPS or Coin Flip (the only two in v1)
//   2. Wager tier — WARM-UP / STAKED / HIGH ROLLER (G$ stake + AI difficulty)
// Then hits CHALLENGE MARKOV-1. The button triggers a transferAndCall on the
// G$ token which routes the wager into ARENA_PLATFORM and creates a match
// targeted at the AI agent. The backend AI agent picks up the MatchProposed
// event, auto-accepts, and plays its move.
//
// Below the picker, two feeds:
//   - Your active matches (the ones you need to play a move in)
//   - Recent global matches (social proof — "real people, real wagers")
//
// Layout mirrors /games (the main games list) so it feels like a sibling
// surface — same juicy 3D cards, same header structure.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { encodeAbiParameters, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC20_ABI } from "@/lib/contracts";
import {
  GAME_TYPES, WAGER_TIERS, MARKOV,
  type GameType, type WagerTier,
  MATCH_STATUS, MATCH_STATUS_LABEL,
  type ArenaMatch,
  moveDisplay,
} from "@/lib/challengeAi";

export default function ChallengeAiHubPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // ─── Picker state ─────────────────────────────────────────────────────────
  const [game, setGame]     = useState<GameType>(GAME_TYPES[0]);   // default RPS
  const [tier, setTier]     = useState<WagerTier>(WAGER_TIERS[1]); // default STAKED
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // ─── Match feeds ───────────────────────────────────────────────────────────
  // Player's match IDs from the contract.
  const { data: matchIds, refetch: refetchIds } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "getPlayerMatches",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12000 },
  });

  // Fetch details for each match ID. Wagmi v2 doesn't batch reads natively,
  // so we use the public client multicall pattern.
  const [matches, setMatches] = useState<ArenaMatch[]>([]);
  useEffect(() => {
    if (!matchIds || !publicClient || (matchIds as readonly bigint[]).length === 0) {
      setMatches([]);
      return;
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
          .map((r, i) => {
            if (r.status !== "success" || !r.result) return null;
            const t = r.result as unknown as readonly [bigint, `0x${string}`, `0x${string}`, bigint, number, number, `0x${string}`, bigint];
            return {
              id:         t[0],
              challenger: t[1],
              opponent:   t[2],
              wager:      t[3],
              gameType:   t[4],
              status:     t[5],
              winner:     t[6],
              createdAt:  t[7],
            };
          })
          .filter((m): m is ArenaMatch => m !== null)
          .sort((a, b) => Number(b.id - a.id));
        setMatches(parsed);
      } catch (e) {
        console.error("[challenge-ai/hub] failed to load matches", e);
      }
    })();
    return () => { cancelled = true; };
  }, [matchIds, publicClient]);

  // Bucket matches by phase so we can render "your turn" prominently.
  const yourTurn = useMemo(() => matches.filter(m => m.status === MATCH_STATUS.ACCEPTED), [matches]);
  const waiting  = useMemo(() => matches.filter(m => m.status === MATCH_STATUS.PROPOSED), [matches]);
  const recent   = useMemo(
    () => matches.filter(m => m.status === MATCH_STATUS.COMPLETED || m.status === MATCH_STATUS.CANCELLED).slice(0, 5),
    [matches],
  );

  // ─── Challenge the agent ───────────────────────────────────────────────────
  // Encodes (action=0 PROPOSE, opponent=AI_AGENT, gameType) and calls
  // transferAndCall on G$ token. The contract's onTokenTransfer hook receives
  // the wager + decodes the args + creates the match.
  async function onChallenge() {
    if (busy) return;
    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return;
    }
    setBusy(true); setError(null);
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
        // Pull the new matchId from the MatchProposed event log.
        const log = receipt.logs.find(l =>
          l.address.toLowerCase() === (CONTRACT_ADDRESSES.ARENA_PLATFORM as string).toLowerCase()
          && l.topics.length >= 2,
        );
        const newId = log ? BigInt(log.topics[1]!) : null;
        if (newId) {
          router.push(`/games/challenge-ai/match/${newId}`);
          return;
        }
      }
      await refetchIds();
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Challenge failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight:    "100vh",
      background:   "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
    }}>
      {/* Ambient backdrop glow */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{
          position: "absolute", top: "8%", left: "-10%", width: 380, height: 380, borderRadius: "50%",
          background: `radial-gradient(circle, ${tier.glow} 0%, transparent 70%)`,
          filter: "blur(40px)",
          transition: "background 0.4s",
        }} />
        <div style={{
          position: "absolute", bottom: "10%", right: "-10%", width: 360, height: 360, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(216,180,254,0.12) 0%, transparent 70%)",
          filter: "blur(40px)",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 560, margin: "0 auto",
        padding:  "18px 14px 28px",
        display:  "flex", flexDirection: "column", gap: 16,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => router.push("/games")}
            style={{
              width: 36, height: 36, borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >←</button>
          <div style={{
            color: "rgba(229,231,235,0.9)", fontSize: 16, fontWeight: 900,
            letterSpacing: "0.12em",
          }}>CHALLENGE AI</div>
          <div style={{ width: 36 }} />
        </div>

        {/* Agent banner — MARKOV-1 */}
        <AgentBanner />

        {/* Game type picker */}
        <Section title="PICK A GAME">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {GAME_TYPES.map(g => (
              <GameChip key={g.id} game={g} selected={game.id === g.id} onSelect={() => setGame(g)} />
            ))}
          </div>
          <div style={{
            marginTop: 6,
            color: "rgba(229,231,235,0.55)", fontSize: 11, fontWeight: 700,
            textAlign: "center",
          }}>{game.rules}</div>
        </Section>

        {/* Wager tier picker */}
        <Section title="WAGER">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {WAGER_TIERS.map(t => (
              <TierChip key={t.id} tier={t} selected={tier.id === t.id} onSelect={() => setTier(t)} />
            ))}
          </div>
          <div style={{
            marginTop: 6,
            color: "rgba(229,231,235,0.55)", fontSize: 11, fontWeight: 700,
            textAlign: "center",
          }}>
            {tier.blurb}
          </div>
        </Section>

        {/* Challenge button */}
        <ChallengeButton
          onClick={onChallenge}
          busy={busy}
          tier={tier}
          gameName={game.shortName}
        />

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5", fontSize: 12, fontWeight: 700,
            textAlign: "center",
          }}>{error}</div>
        )}

        {/* Player-edge note */}
        <div style={{
          padding: "10px 14px", borderRadius: 12,
          background: "rgba(134,239,172,0.08)",
          border: "1px solid rgba(134,239,172,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          color: "rgba(134,239,172,0.92)", fontSize: 11, fontWeight: 800,
          letterSpacing: "0.04em",
        }}>
          🛡️ <span>Player wins all ties. Your structural edge.</span>
        </div>

        {/* Active matches */}
        {(yourTurn.length > 0 || waiting.length > 0) && (
          <Section title="YOUR ACTIVE MATCHES">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {yourTurn.map(m => (
                <MatchRow key={String(m.id)} m={m} status="YOUR TURN" highlight onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
              ))}
              {waiting.map(m => (
                <MatchRow key={String(m.id)} m={m} status="WAITING FOR AI" onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
              ))}
            </div>
          </Section>
        )}

        {/* Recent completed */}
        {recent.length > 0 && (
          <Section title="RECENT MATCHES">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recent.map(m => (
                <MatchRow
                  key={String(m.id)}
                  m={m}
                  status={
                    m.status === MATCH_STATUS.CANCELLED ? "CANCELLED"
                    : address && m.winner.toLowerCase() === address.toLowerCase() ? "YOU WON"
                    : "AI WON"
                  }
                  won={!!address && m.winner.toLowerCase() === address.toLowerCase()}
                  onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)}
                />
              ))}
            </div>
          </Section>
        )}

        <div style={{
          color: "rgba(200,180,255,0.42)", fontSize: 10, fontWeight: 700,
          textAlign: "center", marginTop: 4, lineHeight: 1.5,
        }}>
          MARKOV-1 is a verified ERC-8004 AI agent. All matches settle on Celo.
        </div>
      </div>
    </div>
  );
}

// ─── Section header wrapper ─────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        color: "rgba(229,231,235,0.55)", fontSize: 10, fontWeight: 900,
        letterSpacing: "0.18em",
      }}>{title}</div>
      {children}
    </div>
  );
}

// ─── Agent banner — MARKOV-1 portrait ───────────────────────────────────────
function AgentBanner() {
  return (
    <div style={{
      borderRadius: 18, background: "#1a0550", paddingBottom: 5,
      boxShadow: "0 10px 28px -6px rgba(167,139,250,0.5), 0 0 0 1.5px rgba(216,180,254,0.4)",
    }}>
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: "linear-gradient(160deg, #4a006b 0%, #6b21a8 50%, #312e81 100%)",
        border: "2px solid rgba(216,180,254,0.4)",
        padding: "14px 16px",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", gap: 12,
        boxShadow: "inset 0 6px 16px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.3)",
      }}>
        <div style={{
          position: "absolute", top: 2, left: "5%", right: "5%", height: "44%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 100%)",
          borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
        }} />
        <div style={{
          fontSize: 36, lineHeight: 1, filter: "drop-shadow(0 4px 10px rgba(216,180,254,0.65))",
          flexShrink: 0, position: "relative", zIndex: 1,
        }}>{MARKOV.emoji}</div>
        <div style={{ position: "relative", zIndex: 1, flex: 1, minWidth: 0 }}>
          <div style={{
            color: "white", fontSize: 18, fontWeight: 900,
            letterSpacing: "0.06em",
            textShadow: "0 2px 4px rgba(0,0,0,0.4)",
          }}>{MARKOV.name}</div>
          <div style={{
            color: "rgba(255,255,255,0.78)", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.04em", marginTop: 2,
          }}>{MARKOV.tagline}</div>
        </div>
        <div style={{
          padding: "3px 9px", borderRadius: 999,
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(134,239,172,0.45)",
          color: "#86efac", fontSize: 8, fontWeight: 900,
          letterSpacing: "0.14em",
          position: "relative", zIndex: 1,
        }}>● ONLINE</div>
      </div>
    </div>
  );
}

// ─── GameChip — pickable game type card ─────────────────────────────────────
function GameChip({ game, selected, onSelect }: {
  game: GameType; selected: boolean; onSelect: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter") onSelect(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 14,
        background: selected ? "linear-gradient(180deg, #fde68a 0%, #f59e0b 100%)" : "rgba(255,255,255,0.04)",
        paddingBottom: selected ? 4 : 0,
        boxShadow: selected
          ? "0 8px 20px -4px rgba(245,158,11,0.5), 0 0 0 1.5px #fde68a"
          : "0 0 0 1px rgba(255,255,255,0.08)",
        transition: "all 0.18s",
      }}
    >
      <div style={{
        borderRadius: selected ? "12px 12px 10px 10px" : "14px",
        background: selected
          ? "linear-gradient(160deg, rgba(124,45,0,0.95) 0%, rgba(40,10,0,0.95) 100%)"
          : "rgba(20,10,50,0.55)",
        border: selected ? "2px solid rgba(254,215,170,0.45)" : "1px solid rgba(255,255,255,0.06)",
        padding: "14px 12px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      }}>
        <div style={{ fontSize: 28 }}>{game.moves[0].emoji}{game.moves[1] ? game.moves[1].emoji : ""}</div>
        <div style={{
          color: selected ? "#fde68a" : "rgba(229,231,235,0.85)",
          fontSize: 11, fontWeight: 900, letterSpacing: "0.1em",
          marginTop: 2,
        }}>{game.shortName}</div>
      </div>
    </div>
  );
}

// ─── TierChip — pickable wager tier card ────────────────────────────────────
function TierChip({ tier, selected, onSelect }: {
  tier: WagerTier; selected: boolean; onSelect: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter") onSelect(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 14,
        background: selected ? tier.wall : "rgba(255,255,255,0.04)",
        paddingBottom: selected ? 4 : 0,
        boxShadow: selected
          ? `0 8px 22px -4px ${tier.glow}, 0 0 0 1.5px ${tier.color}88`
          : "0 0 0 1px rgba(255,255,255,0.08)",
        transition: "all 0.18s",
      }}
    >
      <div style={{
        borderRadius: selected ? "12px 12px 10px 10px" : "14px",
        background: selected
          ? tier.face
          : "rgba(20,10,50,0.55)",
        border: selected ? "2px solid rgba(255,255,255,0.4)" : "1px solid rgba(255,255,255,0.06)",
        padding: "12px 8px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        position: "relative", overflow: "hidden",
        boxShadow: selected ? "inset 0 6px 14px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.3)" : "none",
      }}>
        {selected && (
          <div style={{
            position: "absolute", top: 2, left: "8%", right: "8%", height: "44%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, transparent 100%)",
            borderRadius: "12px 12px 50px 50px", pointerEvents: "none",
          }} />
        )}
        <div style={{
          color: selected ? "white" : "rgba(229,231,235,0.85)",
          fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
          textShadow: selected ? "0 1px 2px rgba(0,0,0,0.5)" : "none",
          position: "relative", zIndex: 1,
        }}>{tier.name}</div>
        <div style={{
          color: selected ? "white" : tier.color,
          fontSize: 18, fontWeight: 900, lineHeight: 1.1,
          textShadow: selected ? "0 2px 4px rgba(0,0,0,0.4)" : `0 0 8px ${tier.color}aa`,
          position: "relative", zIndex: 1,
        }}>
          {tier.amount}<span style={{ fontSize: 9, marginLeft: 2 }}>G$</span>
        </div>
      </div>
    </div>
  );
}

// ─── ChallengeButton — the primary CTA ──────────────────────────────────────
function ChallengeButton({ onClick, busy, tier, gameName }: {
  onClick: () => void; busy: boolean; tier: WagerTier; gameName: string;
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={busy ? undefined : onClick}
      onKeyDown={e => { if (!busy && e.key === "Enter") onClick(); }}
      style={{
        cursor: busy ? "wait" : "pointer", userSelect: "none",
        opacity: busy ? 0.7 : 1,
        transition: "opacity 0.12s, transform 0.12s",
        marginTop: 2,
      }}
      onMouseDown={e => { if (!busy) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.985) translateY(2px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: 16, background: tier.wall, paddingBottom: 5,
        boxShadow: `0 12px 30px -4px ${tier.glow}`,
      }}>
        <div style={{
          borderRadius: "14px 14px 12px 12px",
          background: tier.face,
          padding: "16px 18px", textAlign: "center",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.3)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 2, left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <div style={{
            color: "white", fontSize: 14, fontWeight: 900, letterSpacing: "0.14em",
            textShadow: "0 2px 4px rgba(0,0,0,0.4)",
            position: "relative", zIndex: 1,
          }}>
            {busy ? "OPENING MATCH…" : `CHALLENGE MARKOV-1 · ${gameName} · ${tier.amount} G$`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MatchRow — one row in the active / recent feeds ───────────────────────
function MatchRow({ m, status, highlight, won, onOpen }: {
  m: ArenaMatch; status: string;
  highlight?: boolean; won?: boolean;
  onOpen: () => void;
}) {
  const ga = m.gameType === 0 ? "RPS" : m.gameType === 3 ? "COIN" : `G${m.gameType}`;
  const wagerStr = Number(formatUnits(m.wager, 18)).toFixed(2);
  const statusColor = highlight ? "#fbbf24" : won ? "#86efac" : status === "AI WON" ? "#fca5a5" : "rgba(229,231,235,0.55)";
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={e => { if (e.key === "Enter") onOpen(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10,
        padding: "10px 12px", borderRadius: 12,
        background: highlight ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.03)",
        border: highlight ? "1.5px solid rgba(251,191,36,0.5)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{
          color: "rgba(229,231,235,0.92)", fontSize: 12, fontWeight: 900,
          letterSpacing: "0.04em",
        }}>
          #{String(m.id)} · {ga} · {wagerStr} G$
        </div>
        <div style={{
          color: statusColor, fontSize: 9, fontWeight: 800,
          letterSpacing: "0.14em",
        }}>{status} · {MATCH_STATUS_LABEL[m.status]}</div>
      </div>
      <div style={{
        color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 900,
      }}>→</div>
    </div>
  );
}
