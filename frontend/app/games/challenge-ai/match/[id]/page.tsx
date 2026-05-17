"use client";

// ─── /games/challenge-ai/match/[id] ──────────────────────────────────────────
// Active match page. The matchId is the on-chain match id from ARENA_PLATFORM.
// We poll the match struct + per-player hasPlayed/playerMoves and derive a UI
// phase from the contract state:
//
//   WAITING_OPPONENT — match proposed, AI hasn't accepted yet
//   PICK             — both in, player hasn't moved → show move buttons
//   LOCK             — player moved, AI hasn't → suspense + ?/?
//   REVEAL           — both moved, contract settling → flip both at same time
//   RESOLVE          — match completed → outcome panel + return-to-hub
//   CANCELLED        — match cancelled
//
// The LOCK → REVEAL beat is the heart of the experience. Even though the
// chain settles in ~5s, we add a fixed 1.2-2.0s suspense hold AFTER both
// moves are visible so both cards flip in the same animation frame instead
// of staggered.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI } from "@/lib/contracts";
import {
  MARKOV, MATCH_STATUS, derivePhase,
  gameTypeById, moveDisplay, tauntFor,
  WAGER_TIERS,
  type ArenaMatch, type MatchPhase, type WagerTierId,
} from "@/lib/challengeAi";

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = BigInt(params.id || "0");

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // ─── On-chain reads (refetch every few seconds) ──────────────────────────
  const { data: matchTuple, refetch: refetchMatch } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "matches",
    args: [matchId],
    query: { refetchInterval: 3000, enabled: matchId > 0n },
  });

  const match: ArenaMatch | null = useMemo(() => {
    if (!matchTuple) return null;
    const t = matchTuple as unknown as readonly [bigint, `0x${string}`, `0x${string}`, bigint, number, number, `0x${string}`, bigint];
    return {
      id: t[0], challenger: t[1], opponent: t[2], wager: t[3],
      gameType: t[4], status: t[5], winner: t[6], createdAt: t[7],
    };
  }, [matchTuple]);

  // Per-player hasPlayed flags.
  const { data: playerHasPlayed, refetch: refetchPlayer } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: address ? [matchId, address] : undefined,
    query: { refetchInterval: 3000, enabled: !!address && matchId > 0n },
  });
  const aiAddress = CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`;
  const { data: aiHasPlayed, refetch: refetchAi } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: [matchId, aiAddress],
    query: { refetchInterval: 3000, enabled: matchId > 0n },
  });

  // Move reveals — kept FRESH (no caching) so the value we render is what
  // the contract has right now, not whatever was first read when the match
  // hit ACCEPTED. Solidity mappings return 0 by default and a stale read can
  // briefly show the AI as ROCK before the real move propagates. staleTime:0
  // + faster polling closes that window; the explicit refetch on the
  // COMPLETED status flip (below) is the belt-and-braces final pull.
  const { data: playerMove, refetch: refetchPlayerMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: address ? [matchId, address] : undefined,
    query: {
      enabled: !!address && !!playerHasPlayed && matchId > 0n,
      refetchInterval: 2000,
      staleTime: 0,
      gcTime:    0,
    },
  });
  const { data: aiMove, refetch: refetchAiMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: [matchId, aiAddress],
    query: {
      enabled: !!aiHasPlayed && matchId > 0n,
      refetchInterval: 2000,
      staleTime: 0,
      gcTime:    0,
    },
  });

  // ─── UI phase machine ─────────────────────────────────────────────────────
  // Derive from on-chain state, but hold REVEAL artificially for the suspense
  // beat — even after both moves are submitted, the player should see a
  // 1.5-2s "?" lock before the cards flip simultaneously.
  const [holdingReveal, setHoldingReveal] = useState(false);
  const revealHoldStartRef = useRef<number | null>(null);

  const derived = useMemo<MatchPhase>(() => {
    if (!match) return "WAITING_OPPONENT";
    return derivePhase(match.status, !!playerHasPlayed, !!aiHasPlayed, holdingReveal);
  }, [match, playerHasPlayed, aiHasPlayed, holdingReveal]);

  // Suspense hold — fires only when the contract status flips to COMPLETED
  // (the AI agent's resolveMatch call). At that point both moves are
  // guaranteed final on-chain, but the RPC / wagmi cache can still serve a
  // stale read for a moment. We hold the LOCK animation longer than needed,
  // explicitly refetch both moves twice (with a short delay between), and
  // only THEN release the hold so the reveal renders the correct emojis.
  useEffect(() => {
    if (match?.status !== MATCH_STATUS.COMPLETED) return;
    if (revealHoldStartRef.current !== null) return;
    revealHoldStartRef.current = Date.now();
    setHoldingReveal(true);

    // Force-refetch twice — once immediately, once after 800ms — so we win
    // any race with RPC indexing the latest block. The second refetch
    // catches the value if the first one missed.
    let cancelled = false;
    const run = async () => {
      try { await Promise.all([refetchPlayerMove(), refetchAiMove()]); } catch {}
      if (cancelled) return;
      await new Promise(r => setTimeout(r, 800));
      if (cancelled) return;
      try { await Promise.all([refetchPlayerMove(), refetchAiMove()]); } catch {}
    };
    void run();

    // Hold duration scales with wager tier so HIGH ROLLER feels weightier.
    // Bumped from earlier values to give the two refetches time to complete
    // BEFORE the reveal animation runs.
    const tier = wagerTierFromAmount(match.wager);
    const ms = tier === "highroller" ? 2400 : tier === "staked" ? 1900 : 1600;
    const t = setTimeout(() => setHoldingReveal(false), ms);
    return () => { cancelled = true; clearTimeout(t); };
  }, [match?.status, match?.wager, refetchPlayerMove, refetchAiMove]);

  // ─── Move submission ─────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitMove(move: number) {
    if (!match || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
        abi:          ARENA_PLATFORM_ABI,
        functionName: "playMove",
        args:         [matchId, move],
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      await Promise.all([refetchMatch(), refetchPlayer(), refetchAi(), refetchPlayerMove(), refetchAiMove()]);
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Move failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!match || match.id === 0n) {
    return (
      <CenterFrame>
        <div style={{ color: "rgba(229,231,235,0.7)" }}>Loading match #{params.id}…</div>
      </CenterFrame>
    );
  }

  const game = gameTypeById(match.gameType);
  const youWon = match.status === MATCH_STATUS.COMPLETED && !!address && match.winner.toLowerCase() === address.toLowerCase();
  const tierId = wagerTierFromAmount(match.wager);
  const tier = WAGER_TIERS.find(t => t.id === tierId) ?? WAGER_TIERS[1];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      paddingBottom: "calc(60px + env(safe-area-inset-bottom))",
    }}>
      {/* Ambient backdrop tinted by wager tier */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{
          position: "absolute", top: "-12%", left: "50%", transform: "translateX(-50%)",
          width: "min(80vw, 600px)", height: "min(80vw, 600px)", borderRadius: "50%",
          background: `radial-gradient(circle, ${tier.glow} 0%, transparent 60%)`,
          filter: "blur(40px)",
          opacity: derived === "REVEAL" || derived === "RESOLVE" ? 1 : 0.5,
          transition: "opacity 0.5s",
        }} />
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 560, margin: "0 auto",
        padding: "16px 14px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => router.push("/games/challenge-ai")}
            style={{
              width: 36, height: 36, borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >←</button>

          <div style={{ textAlign: "center" }}>
            <div style={{ color: "rgba(229,231,235,0.5)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em" }}>
              MATCH #{String(match.id)}
            </div>
            <div style={{ color: "white", fontSize: 13, fontWeight: 900, letterSpacing: "0.06em" }}>
              {game?.shortName ?? "—"} · {Number(formatUnits(match.wager, 18)).toFixed(2)} G$
            </div>
          </div>

          <div style={{ width: 36 }} />
        </div>

        {/* Status banner */}
        <PhaseBanner phase={derived} />

        {/* Player vs MARKOV-1 cards */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        }}>
          <SideCard
            side="YOU"
            sideColor="#86efac"
            phase={derived}
            move={typeof playerMove === "number" ? playerMove : null}
            won={youWon && derived === "RESOLVE"}
            lost={!youWon && match.status === MATCH_STATUS.COMPLETED && derived === "RESOLVE"}
            gameType={match.gameType}
          />
          <SideCard
            side={MARKOV.name}
            sideColor="#a78bfa"
            phase={derived}
            move={typeof aiMove === "number" ? aiMove : null}
            won={!youWon && match.status === MATCH_STATUS.COMPLETED && derived === "RESOLVE"}
            lost={youWon && derived === "RESOLVE"}
            gameType={match.gameType}
          />
        </div>

        {/* Phase-specific content */}
        {derived === "PICK" && game && (
          <PickPanel
            game={game}
            onPick={submitMove}
            submitting={submitting}
            error={error}
          />
        )}

        {derived === "WAITING_OPPONENT" && (
          <WaitingPanel />
        )}

        {derived === "LOCK" && (
          <LockPanel />
        )}

        {derived === "REVEAL" && (
          <div style={{ height: 8 }} />
        )}

        {derived === "RESOLVE" && (
          <ResolvePanel
            youWon={youWon}
            wager={match.wager}
            tierId={tierId}
            playerMove={typeof playerMove === "number" ? playerMove : null}
            aiMove={typeof aiMove === "number" ? aiMove : null}
            gameType={match.gameType}
            onReturn={() => router.push("/games/challenge-ai")}
          />
        )}

        {derived === "CANCELLED" && (
          <div style={{
            padding: 14, borderRadius: 12,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(229,231,235,0.7)", textAlign: "center",
            fontSize: 12, fontWeight: 700,
          }}>
            Match cancelled. Wager refunded.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function wagerTierFromAmount(wei: bigint): WagerTierId {
  // Match the tier by exact wei amount. If a future custom-wager mode exists
  // and the wei doesn't match a tier, default to STAKED.
  for (const t of WAGER_TIERS) {
    if (t.amountWei === wei) return t.id;
  }
  return "staked";
}

function CenterFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24, color: "rgba(229,231,235,0.7)", fontSize: 13, fontWeight: 700,
    }}>{children}</div>
  );
}

// ─── PhaseBanner ────────────────────────────────────────────────────────────
function PhaseBanner({ phase }: { phase: MatchPhase }) {
  const map: Record<MatchPhase, { text: string; color: string; bg: string }> = {
    WAITING_OPPONENT: { text: "WAITING FOR MARKOV-1 TO ACCEPT…",  color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
    PICK:             { text: "PICK YOUR MOVE",                   color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
    LOCK:             { text: "MARKOV-1 IS CALCULATING…",         color: "#67e8f9", bg: "rgba(103,232,249,0.12)" },
    REVEAL:           { text: "REVEAL!",                          color: "#86efac", bg: "rgba(134,239,172,0.18)" },
    RESOLVE:          { text: "MATCH SETTLED",                    color: "#86efac", bg: "rgba(134,239,172,0.12)" },
    CANCELLED:        { text: "MATCH CANCELLED",                  color: "rgba(229,231,235,0.6)", bg: "rgba(255,255,255,0.04)" },
  };
  const c = map[phase];
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 999,
      background: c.bg,
      border: `1px solid ${c.color}55`,
      color: c.color, fontSize: 11, fontWeight: 900,
      letterSpacing: "0.18em", textAlign: "center",
    }}>{c.text}</div>
  );
}

// ─── SideCard — the LOCK + REVEAL beat ──────────────────────────────────────
function SideCard({ side, sideColor, phase, move, won, lost, gameType }: {
  side: string; sideColor: string; phase: MatchPhase;
  move: number | null;
  won: boolean; lost: boolean;
  gameType: number;
}) {
  // Show emoji only after the reveal phase fires. Before that, both cards
  // show "?" regardless of whether the move is loaded — that's the trick
  // that makes the simultaneous flip feel real.
  const revealed = phase === "REVEAL" || phase === "RESOLVE";
  const display = revealed && move !== null ? moveDisplay(gameType as 0 | 3, move) : { emoji: "?", label: "" };

  return (
    <div style={{
      borderRadius: 18,
      background: won ? "linear-gradient(180deg, #fde68a 0%, #f59e0b 100%)"
                : lost ? "linear-gradient(180deg, #7f1d1d 0%, #1a0550 100%)"
                : `${sideColor}55`,
      paddingBottom: 5,
      boxShadow: won
        ? `0 0 36px ${sideColor}, 0 0 0 2px ${sideColor}`
        : "0 10px 24px -6px rgba(0,0,0,0.6), 0 0 0 1.5px rgba(255,255,255,0.08)",
      transition: "all 0.3s",
      transform: won ? "scale(1.06)" : lost ? "scale(0.97)" : "scale(1)",
      opacity: lost ? 0.7 : 1,
    }}>
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: "linear-gradient(180deg, rgba(30,15,80,0.88) 0%, rgba(10,5,30,0.96) 100%)",
        border: "2px solid rgba(255,255,255,0.15)",
        padding: "14px 12px",
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, minHeight: 150,
      }}>
        <div style={{
          color: sideColor, fontSize: 10, fontWeight: 900,
          letterSpacing: "0.18em", textShadow: `0 0 8px ${sideColor}88`,
        }}>{side}</div>

        <div
          key={`${phase}-${display.emoji}`}
          style={{
            fontSize: 64, lineHeight: 1,
            animation: revealed
              ? "rpsPop 380ms cubic-bezier(0.22, 1, 0.36, 1)"
              : phase === "LOCK" ? "rpsLock 700ms ease-in-out infinite alternate" : "none",
            filter: revealed ? `drop-shadow(0 6px 14px ${sideColor})` : "none",
          }}
        >{display.emoji}</div>

        {revealed && display.label && (
          <div style={{
            color: "rgba(255,255,255,0.92)", fontSize: 11, fontWeight: 900,
            letterSpacing: "0.14em",
          }}>{display.label}</div>
        )}
        {phase === "LOCK" && (
          <div style={{
            color: "rgba(229,231,235,0.5)", fontSize: 10, fontWeight: 800,
            letterSpacing: "0.16em",
          }}>{side === "YOU" ? "LOCKED" : "CALCULATING"}</div>
        )}
      </div>

      <style jsx>{`
        @keyframes rpsPop {
          0%   { transform: scale(0.5) rotate(-10deg); opacity: 0; }
          55%  { transform: scale(1.18) rotate(4deg);  opacity: 1; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        @keyframes rpsLock {
          0%   { opacity: 0.55; transform: scale(1); }
          100% { opacity: 1;    transform: scale(1.06); }
        }
      `}</style>
    </div>
  );
}

// ─── PickPanel — move buttons ───────────────────────────────────────────────
function PickPanel({ game, onPick, submitting, error }: {
  game: NonNullable<ReturnType<typeof gameTypeById>>;
  onPick: (move: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        display: "grid", gridTemplateColumns: `repeat(${game.moves.length}, 1fr)`, gap: 10,
      }}>
        {game.moves.map(m => (
          <MoveBtn
            key={m.id}
            emoji={m.emoji}
            label={m.label}
            disabled={submitting}
            onClick={() => onPick(m.id)}
          />
        ))}
      </div>
      {error && (
        <div style={{
          padding: "8px 12px", borderRadius: 10,
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.45)",
          color: "#fca5a5", fontSize: 11, fontWeight: 700,
          textAlign: "center",
        }}>{error}</div>
      )}
    </div>
  );
}

function MoveBtn({ emoji, label, disabled, onClick }: {
  emoji: string; label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={e => { if (!disabled && e.key === "Enter") onClick(); }}
      style={{
        cursor: disabled ? "wait" : "pointer", userSelect: "none",
        opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.12s, transform 0.12s",
      }}
      onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.96) translateY(3px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: 16, background: "linear-gradient(180deg, #312e81 0%, #1e1b4b 100%)",
        paddingBottom: 5, boxShadow: "0 8px 18px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          borderRadius: "14px 14px 12px 12px",
          background: "linear-gradient(160deg, #818cf8 0%, #6366f1 50%, #4338ca 100%)",
          padding: "14px 8px", textAlign: "center",
          border: "2px solid rgba(255,255,255,0.4)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.3)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 2, left: "8%", right: "8%", height: "44%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <div style={{ fontSize: 36, position: "relative", zIndex: 1 }}>{emoji}</div>
          <div style={{
            color: "white", fontSize: 10, fontWeight: 900,
            letterSpacing: "0.14em", marginTop: 4,
            textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            position: "relative", zIndex: 1,
          }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

// ─── WaitingPanel — AI hasn't accepted yet ──────────────────────────────────
function WaitingPanel() {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: "rgba(167,139,250,0.06)",
      border: "1px solid rgba(167,139,250,0.3)",
      color: "rgba(216,180,254,0.9)", fontSize: 11, fontWeight: 700,
      lineHeight: 1.5, textAlign: "center",
    }}>
      MARKOV-1 is matching your wager. The AI typically accepts within 10 seconds.
    </div>
  );
}

// ─── LockPanel — player moved, waiting on AI to play ─────────────────────────
function LockPanel() {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: "rgba(103,232,249,0.06)",
      border: "1px solid rgba(103,232,249,0.3)",
      color: "rgba(165,243,252,0.92)", fontSize: 11, fontWeight: 700,
      lineHeight: 1.5, textAlign: "center",
    }}>
      Your move is locked on-chain. Waiting for MARKOV-1 to submit. Reveal incoming.
    </div>
  );
}

// ─── ResolvePanel — match completed, show outcome + taunt ───────────────────
function ResolvePanel({ youWon, wager, tierId, playerMove, aiMove, gameType, onReturn }: {
  youWon: boolean;
  wager: bigint;
  tierId: WagerTierId;
  playerMove: number | null;
  aiMove: number | null;
  gameType: number;
  onReturn: () => void;
}) {
  // Tie semantics. Two flavors:
  //   - movesAreEqual: both sides picked the same emoji
  //   - tieByRule:     equal moves AND the chain awarded the challenger
  //                    (player-first rule was applied correctly)
  // If moves are equal but the chain says AI won, that's a resolver bug we
  // shouldn't dress up as a tie. Render it as a straight AI win so the prize
  // figure and the headline don't contradict each other.
  const movesAreEqual = playerMove !== null && aiMove !== null && playerMove === aiMove;
  const tieByRule     = movesAreEqual && youWon;

  // Pick one taunt for this render (stable in a ref so it doesn't flip).
  const tauntRef = useRef<string>("");
  if (tauntRef.current === "") {
    const outcome = tieByRule ? "tie" : youWon ? "lose" : "win";
    tauntRef.current = tauntFor(tierId, outcome);
  }

  const prize = (wager * 2n * 95n) / 100n; // approximate — contract takes a 5% fee
  const prizeStr = Number(formatUnits(prize, 18)).toFixed(2);
  const player = playerMove !== null ? moveDisplay(gameType as 0 | 3, playerMove).label : "—";
  const ai     = aiMove !== null     ? moveDisplay(gameType as 0 | 3, aiMove).label     : "—";

  return (
    <div style={{
      borderRadius: 18,
      background: youWon ? "#7c2d00" : "#1a0550",
      paddingBottom: 5,
      boxShadow: youWon
        ? "0 0 40px rgba(245,158,11,0.55), 0 0 0 2px #fde68a66"
        : "0 0 30px rgba(167,139,250,0.4), 0 0 0 1.5px rgba(255,255,255,0.08)",
      marginTop: 4,
    }}>
      <div style={{
        borderRadius: "16px 16px 14px 14px",
        background: youWon
          ? "linear-gradient(160deg, #fde68a 0%, #f59e0b 50%, #b45309 100%)"
          : "linear-gradient(180deg, rgba(30,15,80,0.92) 0%, rgba(10,5,30,0.96) 100%)",
        border: youWon ? "2px solid rgba(254,215,170,0.5)" : "2px solid rgba(255,255,255,0.15)",
        padding: "20px 18px",
        display: "flex", flexDirection: "column", gap: 12,
        textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        {youWon && (
          <div style={{
            position: "absolute", top: 2, left: "5%", right: "5%", height: "44%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, transparent 100%)",
            borderRadius: "14px 14px 60px 60px", pointerEvents: "none",
          }} />
        )}
        <div style={{
          color: youWon ? "white" : "rgba(167,139,250,0.85)",
          fontSize: 11, fontWeight: 900, letterSpacing: "0.2em",
          textShadow: youWon ? "0 2px 4px rgba(0,0,0,0.4)" : "none",
          position: "relative", zIndex: 1,
        }}>{tieByRule ? "TIE — PLAYER-FIRST RULE" : youWon ? "YOU WIN" : "MARKOV-1 WINS"}</div>

        <div style={{
          color: "white", fontSize: 32, fontWeight: 900, lineHeight: 1,
          textShadow: youWon ? "0 4px 12px rgba(0,0,0,0.4)" : "0 0 14px rgba(167,139,250,0.4)",
          position: "relative", zIndex: 1,
        }}>{youWon ? `+${prizeStr} G$` : `−${Number(formatUnits(wager, 18)).toFixed(2)} G$`}</div>

        <div style={{
          color: youWon ? "rgba(255,255,255,0.85)" : "rgba(229,231,235,0.55)",
          fontSize: 11, fontWeight: 700,
          letterSpacing: "0.04em",
          position: "relative", zIndex: 1,
        }}>YOU played {player} · MARKOV-1 played {ai}</div>

        {tauntRef.current && (
          <div style={{
            padding: "8px 12px", borderRadius: 10,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "rgba(229,231,235,0.92)",
            fontSize: 11, fontWeight: 700,
            fontStyle: "italic",
            position: "relative", zIndex: 1,
            marginTop: 4,
          }}>
            🤖 “{tauntRef.current}”
          </div>
        )}

        <button
          onClick={onReturn}
          style={{
            padding: "12px", borderRadius: 12,
            background: youWon ? "rgba(0,0,0,0.25)" : "rgba(167,139,250,0.18)",
            border: youWon ? "1.5px solid rgba(255,255,255,0.45)" : "1.5px solid rgba(167,139,250,0.45)",
            color: "white", fontSize: 12, fontWeight: 900,
            letterSpacing: "0.14em", cursor: "pointer",
            marginTop: 6,
            position: "relative", zIndex: 1,
          }}
        >BACK TO LOBBY</button>
      </div>
    </div>
  );
}
