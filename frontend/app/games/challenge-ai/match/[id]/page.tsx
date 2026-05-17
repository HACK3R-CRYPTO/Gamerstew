"use client";

// ─── /games/challenge-ai/match/[id] ──────────────────────────────────────────
// Arena match — runs the full VS → PICK → LOCK → REVEAL → RESULT flow over the
// on-chain match state. Layout follows the claude.ai/design handoff: arena
// floor in the background, combatants stacked vertically, reveal explosion in
// the middle, hero coin / skull on the result screen.
//
// On-chain state stays the source of truth. The UI phase is derived from the
// contract status + the per-player hasPlayed flags. REVEAL holds for ~1.6-2.4s
// after the contract flips to COMPLETED so the simultaneous flip lands with
// drama, and we double-refetch moves during the hold to win the RPC race.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI } from "@/lib/contracts";
import {
  MARKOV, MATCH_STATUS, derivePhase,
  gameTypeById, moveDisplay, tauntFor,
  WAGER_TIERS,
  type ArenaMatch, type MatchPhase, type WagerTier, type WagerTierId,
} from "@/lib/challengeAi";

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = BigInt(params.id || "0");

  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // ─── On-chain reads ──────────────────────────────────────────────────────
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

  const aiAddress = CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`;
  const { data: playerHasPlayed, refetch: refetchPlayer } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: address ? [matchId, address] : undefined,
    query: { refetchInterval: 3000, enabled: !!address && matchId > 0n },
  });
  const { data: aiHasPlayed, refetch: refetchAi } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: [matchId, aiAddress],
    query: { refetchInterval: 3000, enabled: matchId > 0n },
  });

  // Moves — kept FRESH (no caching) so the rendered emoji matches the chain.
  const { data: playerMove, refetch: refetchPlayerMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: address ? [matchId, address] : undefined,
    query: {
      enabled: !!address && !!playerHasPlayed && matchId > 0n,
      refetchInterval: 2000, staleTime: 0, gcTime: 0,
    },
  });
  const { data: aiMove, refetch: refetchAiMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: [matchId, aiAddress],
    query: {
      enabled: !!aiHasPlayed && matchId > 0n,
      refetchInterval: 2000, staleTime: 0, gcTime: 0,
    },
  });

  // ─── UI phase machine ────────────────────────────────────────────────────
  const [holdingReveal, setHoldingReveal] = useState(false);
  const revealHoldStartRef = useRef<number | null>(null);
  const derived = useMemo<MatchPhase>(() => {
    if (!match) return "WAITING_OPPONENT";
    return derivePhase(match.status, !!playerHasPlayed, !!aiHasPlayed, holdingReveal);
  }, [match, playerHasPlayed, aiHasPlayed, holdingReveal]);

  useEffect(() => {
    if (match?.status !== MATCH_STATUS.COMPLETED) return;
    if (revealHoldStartRef.current !== null) return;
    revealHoldStartRef.current = Date.now();
    setHoldingReveal(true);

    let cancelled = false;
    const run = async () => {
      try { await Promise.all([refetchPlayerMove(), refetchAiMove()]); } catch {}
      if (cancelled) return;
      await new Promise(r => setTimeout(r, 800));
      if (cancelled) return;
      try { await Promise.all([refetchPlayerMove(), refetchAiMove()]); } catch {}
    };
    void run();

    const tier = wagerTierFromAmount(match.wager);
    const ms = tier === "highroller" ? 2400 : tier === "staked" ? 1900 : 1600;
    const t = setTimeout(() => setHoldingReveal(false), ms);
    return () => { cancelled = true; clearTimeout(t); };
  }, [match?.status, match?.wager, refetchPlayerMove, refetchAiMove]);

  // ─── VS intro — show only once on initial mount while the AI is still
  // accepting OR if the player landed mid-PICK on a fresh match (createdAt
  // within the last ~15s). Skip for resumed mid-match URLs so refreshes don't
  // replay the intro every time.
  const [showVS, setShowVS] = useState(true);
  const vsArmedRef = useRef(false);
  useEffect(() => {
    if (vsArmedRef.current) return;
    if (!match) return;
    vsArmedRef.current = true;

    // If the match is already past PROPOSED and the player has already moved,
    // skip the VS intro entirely — they've been here.
    if (match.status >= MATCH_STATUS.COMPLETED) { setShowVS(false); return; }
    if (match.status === MATCH_STATUS.ACCEPTED && playerHasPlayed) {
      setShowVS(false); return;
    }

    // Otherwise hold the VS intro for 2.4s.
    const t = setTimeout(() => setShowVS(false), 2400);
    return () => clearTimeout(t);
  }, [match, playerHasPlayed]);

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
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
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

  // ─── Render ──────────────────────────────────────────────────────────────
  if (!match || match.id === 0n) {
    return (
      <CenterFrame>
        <div style={{ color: "rgba(220,210,255,0.7)", fontSize: 13, fontWeight: 700 }}>
          Loading match #{params.id}…
        </div>
      </CenterFrame>
    );
  }

  const game = gameTypeById(match.gameType);
  const youWon = match.status === MATCH_STATUS.COMPLETED && !!address && match.winner.toLowerCase() === address.toLowerCase();
  const tierId = wagerTierFromAmount(match.wager);
  const tier = WAGER_TIERS.find(t => t.id === tierId) ?? WAGER_TIERS[1];
  const wagerStr = Number(formatUnits(match.wager, 18)).toFixed(2);
  const onExit = () => router.push("/games/challenge-ai");

  // Tie semantics (only meaningful at RESOLVE).
  const movesAreEqual = playerMove !== null && aiMove !== null && playerMove === aiMove;
  const tieByRule     = movesAreEqual && youWon;

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      background: "#04001a",
      paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
      overflow: "hidden",
    }}>
      {/* Arena floor — fixed background */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/games/challenge-ai/ai-arena.jpeg" alt="" style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        objectFit: "cover", opacity: 0.35, pointerEvents: "none", zIndex: 0,
      }} />
      <div aria-hidden style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "linear-gradient(180deg, transparent 0%, rgba(4,0,26,0.6) 60%, rgba(4,0,26,0.95) 100%)",
      }} />

      {/* Close button */}
      <button onClick={onExit} style={{
        position: "absolute", top: 14, left: 14, zIndex: 10,
        width: 34, height: 34, borderRadius: 999, cursor: "pointer",
        background: "rgba(0,0,0,0.55)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white", fontSize: 16, fontWeight: 900,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(6px)",
      }}>×</button>

      {/* Match badge — top center */}
      <div style={{
        position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 9,
        padding: "6px 14px", borderRadius: 999,
        background: "rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ color: "rgba(220,210,255,0.5)", fontSize: 9, fontWeight: 800, letterSpacing: "0.18em" }}>
          #{String(match.id)}
        </span>
        <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.15)" }} />
        <span style={{ color: "white", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em" }}>
          {game?.shortName ?? "—"} · {wagerStr} G$
        </span>
      </div>

      {/* ─── Phase content ─────────────────────────────────────────────── */}
      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 560, margin: "0 auto",
        minHeight: "100vh",
        display: "flex", flexDirection: "column",
        padding: "60px 16px 20px",
      }}>
        {showVS && (derived === "WAITING_OPPONENT" || derived === "PICK") ? (
          <ArenaVS tier={tier} />
        ) : derived === "WAITING_OPPONENT" ? (
          <WaitingScreen tier={tier} />
        ) : derived === "RESOLVE" ? (
          <ResultScreen
            tier={tier}
            youWon={youWon}
            tieByRule={tieByRule}
            wager={match.wager}
            playerMove={typeof playerMove === "number" ? playerMove : null}
            aiMove={typeof aiMove === "number" ? aiMove : null}
            gameType={match.gameType}
            onAgain={() => router.push("/games/challenge-ai")}
            onExit={onExit}
          />
        ) : (
          <MatchStage
            tier={tier}
            game={game!}
            phase={derived}
            playerMove={typeof playerMove === "number" ? playerMove : null}
            aiMove={typeof aiMove === "number" ? aiMove : null}
            onPick={submitMove}
            submitting={submitting}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

// ─── ArenaVS — the cinematic pre-match sting ────────────────────────────────
function ArenaVS({ tier }: { tier: WagerTier }) {
  return (
    <div style={{
      flex: 1,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      padding: "20px 6px 30px",
      animation: "fadeIn 0.3s ease both",
      position: "relative",
    }}>
      {/* Sunburst behind VS */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/games/challenge-ai/ai-burst.jpeg" alt="" style={{
        position: "absolute", top: "45%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 460, height: 460, objectFit: "contain",
        opacity: 0.55, pointerEvents: "none",
        mixBlendMode: "screen",
        animation: "vs-burst 2.4s ease-out both",
      }} />

      {/* Player (top) */}
      <div style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        animation: "vs-slide-in-left 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}>
        <div style={{ color: "rgba(220,210,255,0.45)", fontSize: 10, fontWeight: 800, letterSpacing: "0.18em" }}>YOU</div>
        <div style={{
          width: 132, height: 132, borderRadius: "50%",
          background: "radial-gradient(circle at 35% 30%, rgba(134,239,172,0.7), rgba(34,197,94,0.15))",
          border: "2.5px solid #86efac",
          boxShadow: "0 0 36px rgba(134,239,172,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          <span style={{ fontSize: 72 }}>🧑</span>
        </div>
        <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>Challenger</div>
        <div style={{ color: "rgba(220,210,255,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>
          PLAYER · TIE GOES TO YOU
        </div>
      </div>

      {/* VS art */}
      <div style={{
        position: "relative", display: "flex", justifyContent: "center",
        animation: "vs-zoom 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/games/challenge-ai/ai-vs.png" alt="VS" style={{
          width: 200, height: 200, objectFit: "contain",
          filter: "drop-shadow(0 0 30px rgba(56,189,248,0.7))",
        }} />
      </div>

      {/* AI (bottom) */}
      <div style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        animation: "vs-slide-in-right 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}>
        <div style={{
          width: 132, height: 132, borderRadius: "50%",
          background: tier.portraitBg,
          border: `2.5px solid ${tier.rim}`,
          boxShadow: `0 0 36px ${tier.rim}77`,
          overflow: "hidden",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tier.art} alt={tier.persona} style={{
            width: "125%", height: "125%", objectFit: "cover",
            transform: "translate(-12%, -12%)",
            mixBlendMode: "plus-lighter",
            filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.6))",
          }} />
        </div>
        <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>{tier.persona}</div>
        <div style={{ color: tier.rim, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em" }}>
          {tier.difficulty} · {tier.multi}×
        </div>
        <div style={{ color: "rgba(220,210,255,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>
          AI · ERC-8004
        </div>
      </div>
    </div>
  );
}

// ─── WaitingScreen — post-VS, AI hasn't accepted yet ────────────────────────
function WaitingScreen({ tier }: { tier: WagerTier }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 18,
      animation: "fadeIn 0.3s ease both",
    }}>
      <div style={{
        width: 152, height: 152, borderRadius: "50%",
        background: tier.portraitBg,
        border: `2.5px solid ${tier.rim}`,
        boxShadow: `0 0 36px ${tier.rim}66`,
        overflow: "hidden",
        animation: "float-gentle 3s ease-in-out infinite",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tier.art} alt={tier.persona} style={{
          width: "125%", height: "125%", objectFit: "cover",
          transform: "translate(-12%, -12%)",
          mixBlendMode: "plus-lighter",
        }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: tier.rim, fontSize: 11, fontWeight: 900, letterSpacing: "0.2em" }}>
          MATCHING WAGER
        </div>
        <div style={{ color: "white", fontSize: 24, fontWeight: 900, marginTop: 6 }}>
          {tier.persona} is locking in…
        </div>
        <div style={{ color: "rgba(220,210,255,0.6)", fontSize: 12, marginTop: 10, maxWidth: 300, lineHeight: 1.45 }}>
          The AI typically accepts within ~10 seconds. Match opens automatically when both stakes are escrowed.
        </div>
      </div>
      <ThreeDot color={tier.rim} />
    </div>
  );
}

function ThreeDot({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: color,
          animation: `dot-pulse 1.2s ease-in-out infinite ${i * 0.18}s`,
        }} />
      ))}
    </div>
  );
}

// ─── MatchStage — PICK / LOCK / REVEAL share this layout ────────────────────
function MatchStage({ tier, game, phase, playerMove, aiMove, onPick, submitting, error }: {
  tier: WagerTier;
  game: NonNullable<ReturnType<typeof gameTypeById>>;
  phase: MatchPhase;
  playerMove: number | null;
  aiMove: number | null;
  onPick: (move: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  const revealed = phase === "REVEAL";

  // Outcome (during REVEAL only) — for combatant-cheer / combatant-hit anims.
  let outcome: "win" | "lose" | "tie" | null = null;
  if (revealed && playerMove !== null && aiMove !== null) {
    if (playerMove === aiMove) outcome = "tie";
    else {
      // RPS: 0=rock 1=paper 2=scissors. Paper > rock, rock > scissors, scissors > paper.
      // Coin: 0 vs 1 — straight match check above + a winner. With tie-rule, ties to player.
      if (game.id === 0) {
        const beats: Record<number, number> = { 0: 2, 1: 0, 2: 1 };
        outcome = beats[playerMove] === aiMove ? "win" : "lose";
      } else {
        outcome = "lose"; // ties already handled above; coin: not equal means one of them wins
      }
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* Battle stage */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: "10px 0 4px",
      }}>
        {/* AI (top) */}
        <Combatant
          side="ai" tier={tier}
          pick={revealed ? aiMove : phase === "LOCK" ? null : null}
          revealing={revealed}
          phase={phase}
          outcomeForThisSide={outcome === "win" ? "lose" : outcome === "lose" ? "win" : outcome}
          gameId={game.id}
        />

        {/* Reveal explosion */}
        <div style={{ position: "relative", height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {revealed && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/games/challenge-ai/ai-glitch.jpeg" alt="" style={{
                position: "absolute", width: 260, height: 260,
                objectFit: "contain", opacity: 0.65,
                mixBlendMode: "screen",
                animation: "reveal-burst 0.7s ease-out both",
                pointerEvents: "none",
              }} />
              <div style={{
                fontSize: 28, fontWeight: 900, letterSpacing: "0.06em",
                color: outcome === "win" ? "#22c55e" : outcome === "tie" ? "#fbbf24" : "#f43f5e",
                textShadow: `0 0 24px ${outcome === "win" ? "#22c55e" : outcome === "tie" ? "#fbbf24" : "#f43f5e"}`,
                animation: "reveal-text 0.6s ease-out both",
                position: "relative", zIndex: 1,
              }}>
                {outcome === "win" ? "YOU WIN" : outcome === "tie" ? "TIE — YOURS" : "MARKOV WINS"}
              </div>
            </>
          )}
          {phase === "LOCK" && (
            <div style={{
              color: "#67e8f9", fontSize: 12, fontWeight: 900, letterSpacing: "0.2em",
              animation: "pulse 1.2s ease-in-out infinite",
            }}>MARKOV-1 IS CALCULATING…</div>
          )}
          {phase === "PICK" && (
            <div style={{
              color: "#fbbf24", fontSize: 12, fontWeight: 900, letterSpacing: "0.2em",
              animation: "pulse 1.4s ease-in-out infinite",
            }}>PICK YOUR MOVE</div>
          )}
        </div>

        {/* Player (bottom) */}
        <Combatant
          side="player" tier={tier}
          pick={playerMove !== null ? playerMove : null}
          revealing={revealed}
          phase={phase}
          outcomeForThisSide={outcome}
          gameId={game.id}
        />
      </div>

      {/* Choices — only during PICK */}
      {phase === "PICK" && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(${game.moves.length}, 1fr)`,
          gap: 10, marginTop: 8,
        }}>
          {game.moves.map(m => (
            <button
              key={m.id}
              onClick={() => onPick(m.id)}
              disabled={submitting}
              style={{
                padding: "18px 0 14px", borderRadius: 18,
                background: "rgba(255,255,255,0.06)",
                border: `1.5px solid rgba(255,255,255,0.1)`,
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.5 : 1,
                transition: "all 0.15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                color: "white",
              }}
              onMouseEnter={e => {
                if (submitting) return;
                (e.currentTarget as HTMLButtonElement).style.background = `${tier.rim}1f`;
                (e.currentTarget as HTMLButtonElement).style.borderColor = `${tier.rim}66`;
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 24px ${tier.rim}33`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: 34 }}>{m.emoji}</span>
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: "rgba(220,210,255,0.65)" }}>
                {m.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* LOCK state — small "your move is escrowed" pill */}
      {phase === "LOCK" && (
        <div style={{
          marginTop: 8, padding: "10px 14px", borderRadius: 12,
          background: "rgba(103,232,249,0.06)",
          border: "1px solid rgba(103,232,249,0.3)",
          color: "rgba(165,243,252,0.92)", fontSize: 11, fontWeight: 700,
          textAlign: "center", lineHeight: 1.45,
        }}>
          Your move is locked on-chain. Reveal incoming.
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 8, padding: "10px 14px", borderRadius: 12,
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.4)",
          color: "#fca5a5", fontSize: 11, fontWeight: 700,
          textAlign: "center",
        }}>{error}</div>
      )}
    </div>
  );
}

// ─── Combatant — portrait + pick reveal in one strip ────────────────────────
function Combatant({ side, tier, pick, revealing, phase, outcomeForThisSide, gameId }: {
  side: "player" | "ai";
  tier: WagerTier;
  pick: number | null;
  revealing: boolean;
  phase: MatchPhase;
  outcomeForThisSide: "win" | "lose" | "tie" | null;
  gameId: 0 | 3;
}) {
  const isPlayer = side === "player";
  const accent  = isPlayer ? "#86efac" : tier.rim;
  const sideLabel = isPlayer ? "YOU" : tier.persona.toUpperCase();
  const showPick = (isPlayer && pick !== null) || (revealing && pick !== null);

  const animation = revealing && outcomeForThisSide === "win"
    ? "combatant-cheer 0.6s ease-out"
    : revealing && outcomeForThisSide === "lose"
      ? "combatant-hit 0.6s ease-out"
      : "none";

  return (
    <div style={{
      display: "flex", flexDirection: isPlayer ? "row" : "row-reverse",
      alignItems: "center", gap: 14, padding: "0 4px",
      animation,
    }}>
      {/* Portrait */}
      <div style={{
        width: 92, height: 92, borderRadius: "50%",
        background: isPlayer
          ? "radial-gradient(circle at 35% 30%, rgba(134,239,172,0.7), rgba(34,197,94,0.15))"
          : tier.portraitBg,
        border: `2.5px solid ${accent}`,
        boxShadow: `0 0 22px ${accent}66, inset 0 -2px 8px rgba(0,0,0,0.4)`,
        overflow: "hidden", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {isPlayer ? (
          <span style={{ fontSize: 52 }}>🧑</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tier.art} alt="" style={{
            width: "125%", height: "125%", objectFit: "cover",
            transform: "translate(-12%, -12%)",
            mixBlendMode: "plus-lighter",
          }} />
        )}
      </div>

      {/* Pick card */}
      <div style={{
        width: 96, height: 96, borderRadius: 18,
        background: showPick
          ? `linear-gradient(180deg, ${accent}33, rgba(0,0,0,0.5))`
          : "rgba(255,255,255,0.04)",
        border: `1.5px solid ${showPick ? accent + "99" : "rgba(255,255,255,0.1)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: showPick ? `0 0 24px ${accent}55` : "none",
        animation: showPick ? "pick-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
        flexShrink: 0,
      }}>
        {showPick && pick !== null ? (
          <span style={{ fontSize: 50, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>
            {moveDisplay(gameId, pick).emoji}
          </span>
        ) : (
          <span style={{ fontSize: 36, color: "rgba(220,210,255,0.4)", fontWeight: 900 }}>
            {phase === "LOCK" && isPlayer ? "🔒" : "?"}
          </span>
        )}
      </div>

      {/* Label strip */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: accent, fontSize: 10, fontWeight: 900, letterSpacing: "0.16em",
          textShadow: `0 0 6px ${accent}99`,
        }}>{sideLabel}</div>
        {!isPlayer && (
          <div style={{
            color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 700,
            letterSpacing: "0.1em", marginTop: 2,
          }}>{tier.difficulty} · AI</div>
        )}
        {isPlayer && (
          <div style={{
            color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 700,
            letterSpacing: "0.1em", marginTop: 2,
          }}>TIES GO TO YOU</div>
        )}
      </div>
    </div>
  );
}

// ─── ResultScreen — design's coin / skull payout ─────────────────────────────
function ResultScreen({ tier, youWon, tieByRule, wager, playerMove, aiMove, gameType, onAgain, onExit }: {
  tier: WagerTier;
  youWon: boolean;
  tieByRule: boolean;
  wager: bigint;
  playerMove: number | null;
  aiMove: number | null;
  gameType: number;
  onAgain: () => void;
  onExit: () => void;
}) {
  // One taunt per render, frozen in a ref so it doesn't churn.
  const tauntRef = useRef<string>("");
  if (tauntRef.current === "") {
    const outcome = tieByRule ? "tie" : youWon ? "lose" : "win";
    tauntRef.current = tauntFor(tier.id, outcome);
  }
  const lineFromTier = tieByRule ? tier.lines.tie : youWon ? tier.lines.lose : tier.lines.win;
  const aiLine = tauntRef.current || lineFromTier;

  // Payout — match the contract's 5% fee math.
  const prize    = (wager * 2n * 95n) / 100n;
  const prizeStr = Number(formatUnits(prize, 18)).toFixed(2);
  const wagerStr = Number(formatUnits(wager, 18)).toFixed(2);

  const player = playerMove !== null ? moveDisplay(gameType as 0 | 3, playerMove).label : "—";
  const ai     = aiMove !== null     ? moveDisplay(gameType as 0 | 3, aiMove).label     : "—";
  const headline = youWon ? "VICTORY" : tieByRule ? "STALEMATE" : "DEFEATED";
  const headlineColor = youWon ? "#86efac" : tieByRule ? "#fde68a" : "#fda4af";
  const headlineGlow  = youWon ? "rgba(34,197,94,0.55)" : tieByRule ? "rgba(251,191,36,0.55)" : "rgba(244,63,94,0.55)";

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "30px 16px 0",
      animation: "fadeIn 0.3s ease both",
      position: "relative",
    }}>
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(60% 50% at 50% 30%, ${headlineGlow.replace("0.55", "0.35")} 0%, transparent 60%)`,
      }} />

      <div style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
      }}>
        {/* Hero coin / skull */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {youWon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/games/challenge-ai/ai-burst.jpeg" alt="" style={{
              position: "absolute", inset: -60,
              width: "calc(100% + 120px)", height: "calc(100% + 120px)",
              objectFit: "contain", opacity: 0.75, mixBlendMode: "screen",
              animation: "result-rays 4s linear infinite", pointerEvents: "none",
            }} />
          )}
          {youWon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/games/challenge-ai/ai-coin.jpeg" alt="" style={{
              width: 168, height: 168, borderRadius: "50%",
              objectFit: "cover",
              boxShadow: "0 0 40px rgba(251,191,36,0.65), 0 12px 30px rgba(0,0,0,0.55)",
              animation: "coin-spin 0.7s cubic-bezier(0.16, 1, 0.3, 1), float-gentle 3.5s ease-in-out infinite 0.7s",
              border: "3px solid rgba(255,255,255,0.4)",
              position: "relative", zIndex: 1,
            }} />
          ) : (
            <div style={{
              width: 152, height: 152, borderRadius: "50%",
              background: tieByRule
                ? "radial-gradient(circle at 35% 30%, rgba(251,191,36,0.5), rgba(180,83,9,0.2))"
                : tier.portraitBg,
              border: `3px solid ${tieByRule ? "#fbbf24" : tier.rim}`,
              boxShadow: `0 0 36px ${tieByRule ? "rgba(251,191,36,0.5)" : tier.rim + "66"}`,
              overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: "popIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}>
              {tieByRule ? (
                <span style={{ fontSize: 78 }}>🤝</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tier.art} alt={tier.persona} style={{
                  width: "130%", height: "130%", objectFit: "cover",
                  transform: "translate(-12%, -12%)",
                  mixBlendMode: "plus-lighter",
                  filter: "grayscale(0.25)",
                }} />
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{
            color: "rgba(220,210,255,0.55)", fontSize: 11, fontWeight: 800, letterSpacing: "0.22em",
          }}>{headline}</div>
          <div style={{
            color: headlineColor, fontSize: 38, fontWeight: 900, lineHeight: 1, marginTop: 8,
            textShadow: `0 0 28px ${headlineGlow}`,
          }}>{youWon ? `+${prizeStr} G$` : tieByRule ? "Stake returned" : `−${wagerStr} G$`}</div>
          <div style={{
            color: "rgba(220,210,255,0.7)", fontSize: 12, marginTop: 10,
            maxWidth: 300, lineHeight: 1.5, marginLeft: "auto", marginRight: "auto",
          }}>
            {youWon
              ? `You bested ${tier.persona}. ${tier.multi}× payout credited.`
              : tieByRule
                ? "Equal move. Player-first rule applied — your stake is returned."
                : `${tier.persona} read your pattern. The pot is theirs.`}
          </div>
          <div style={{
            color: "rgba(220,210,255,0.6)", fontSize: 11, fontWeight: 700, marginTop: 8,
            letterSpacing: "0.04em",
          }}>
            YOU played {player} · {tier.persona} played {ai}
          </div>
          {aiLine && (
            <div style={{
              color: tier.rim, fontSize: 12, fontStyle: "italic", marginTop: 12,
              opacity: 0.92,
            }}>“{aiLine}”</div>
          )}
        </div>

        {/* CTAs */}
        <div style={{ width: "100%", maxWidth: 360, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onAgain} style={{
            padding: "14px", borderRadius: 14,
            background: `linear-gradient(180deg, ${tier.rim}, ${tier.rim}cc)`,
            border: `1.5px solid ${tier.rim}`,
            boxShadow: `0 10px 22px -6px ${tier.rim}99, inset 0 1px 0 rgba(255,255,255,0.4)`,
            color: "#04001a", fontSize: 14, fontWeight: 900, letterSpacing: "0.06em",
            cursor: "pointer",
          }}>
            {youWon ? `REMATCH ${tier.persona}` : tieByRule ? "REMATCH" : "AVENGE YOURSELF"}
          </button>
          <button onClick={onExit} style={{
            padding: "12px", borderRadius: 12,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(220,210,255,0.7)", fontSize: 12, fontWeight: 800,
            letterSpacing: "0.1em", cursor: "pointer",
          }}>BACK TO LOBBY</button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function wagerTierFromAmount(wei: bigint): WagerTierId {
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
      padding: 24,
    }}>{children}</div>
  );
}
