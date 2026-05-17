"use client";

// ─── /games/challenge-ai — the arcade cabinet ────────────────────────────────
// One page, no routing. The cabinet IS the game.
//
// State flow (all on one screen, no remounts):
//   IDLE          — persona idle in CRT, stake select + TAP TO CHALLENGE
//   OPENING_TX    — wallet tx submitting (loader)
//   PROPOSED      — match on chain, AI accepting (~10s)
//   PICK          — player picks a move (move buttons rise inside cabinet)
//   LOCK          — player moved, AI hasn't (suspense)
//   REVEAL        — both moves visible, light burst (1.5-2.4s hold)
//   RESULT        — coin rain on win, X overlay on loss + payout
//   then back to IDLE without leaving the page — button becomes REMATCH
//
// We resume from on-chain state: getPlayerMatches → latest non-cancelled
// match drives the cabinet. If the player navigates away mid-match, coming
// back picks up where they left off.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { encodeAbiParameters, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC20_ABI } from "@/lib/contracts";
import {
  GAME_TYPES, WAGER_TIERS, MATCH_STATUS,
  gameTypeById, moveDisplay, tauntFor,
  type ArenaMatch, type GameType, type WagerTier, type WagerTierId,
} from "@/lib/challengeAi";

// Image mask — kills any rectangular bg behind the bot images. Transparent
// PNGs (when the user drops them in) won't need this but it's harmless.
const imgMask = {
  WebkitMaskImage: "radial-gradient(circle at 50% 45%, black 55%, transparent 82%)",
  maskImage:       "radial-gradient(circle at 50% 45%, black 55%, transparent 82%)",
};

type Phase =
  | "IDLE"
  | "OPENING_TX"
  | "PROPOSED"
  | "PICK"
  | "LOCK"
  | "REVEAL"
  | "RESULT";

export default function ChallengeAiCabinet() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // ─── Selection (cabinet "dial" state) ────────────────────────────────────
  const [tier, setTier] = useState<WagerTier>(WAGER_TIERS[1]); // STAKED default
  const [game, setGame] = useState<GameType>(GAME_TYPES[0]);

  // ─── On-chain reads — drive the cabinet from the latest match ────────────
  const { data: gBalanceRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 20000 },
  });
  const gBalance = gBalanceRaw != null
    ? parseFloat(formatUnits(gBalanceRaw as bigint, 18)).toFixed(2)
    : "—";

  const { data: matchIds, refetch: refetchIds } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "getPlayerMatches",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 6000 },
  });

  // Resolve all match tuples (one multicall) so we can pick the "current" and
  // render the receipt tape from the recent completed ones.
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

  // Active match = latest match that isn't cancelled. Drives the cabinet.
  const activeMatch = useMemo(() => {
    return matches.find(m => m.status !== MATCH_STATUS.CANCELLED) ?? null;
  }, [matches]);

  // Past completed matches → receipt tape (5 most recent).
  const recent = useMemo(() => matches.filter(m =>
    m.status === MATCH_STATUS.COMPLETED
  ).slice(0, 5), [matches]);

  // ─── Per-player hasPlayed + moves for active match ───────────────────────
  const aiAddress = CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`;
  const matchId   = activeMatch?.id ?? 0n;
  const matchEnabled = matchId > 0n && !!address;

  const { data: playerHasPlayed, refetch: refetchPlayer } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: address && matchEnabled ? [matchId, address] : undefined,
    query: { enabled: matchEnabled, refetchInterval: 3000 },
  });
  const { data: aiHasPlayed, refetch: refetchAi } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "hasPlayed",
    args: matchEnabled ? [matchId, aiAddress] : undefined,
    query: { enabled: matchEnabled, refetchInterval: 3000 },
  });
  const { data: playerMove, refetch: refetchPlayerMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: address && matchEnabled ? [matchId, address] : undefined,
    query: { enabled: matchEnabled && !!playerHasPlayed, refetchInterval: 2000, staleTime: 0, gcTime: 0 },
  });
  const { data: aiMove, refetch: refetchAiMove } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "playerMoves",
    args: matchEnabled ? [matchId, aiAddress] : undefined,
    query: { enabled: matchEnabled && !!aiHasPlayed, refetchInterval: 2000, staleTime: 0, gcTime: 0 },
  });

  // ─── Phase machine ───────────────────────────────────────────────────────
  const [openingTx, setOpeningTx] = useState(false);   // wallet tx in flight
  const [holdingReveal, setHoldingReveal] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>(null); // ack'd match id
  const revealHoldStartRef = useRef<bigint | null>(null);

  // When the active match COMPLETES, hold REVEAL for a beat then drop to RESULT.
  useEffect(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.COMPLETED) return;
    if (revealHoldStartRef.current === activeMatch.id) return; // already armed
    revealHoldStartRef.current = activeMatch.id;
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

    const tierLocal = wagerTierFromAmount(activeMatch.wager);
    const ms = tierLocal === "highroller" ? 2200 : tierLocal === "staked" ? 1700 : 1400;
    const t = setTimeout(() => setHoldingReveal(false), ms);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeMatch?.id, activeMatch?.status, activeMatch?.wager, refetchPlayerMove, refetchAiMove, activeMatch]);

  const phase: Phase = useMemo(() => {
    if (openingTx) return "OPENING_TX";
    if (!activeMatch) return "IDLE";
    if (activeMatch.status === MATCH_STATUS.COMPLETED) {
      // If the player already saw this result and acknowledged it, drop to IDLE.
      if (acknowledged === String(activeMatch.id)) return "IDLE";
      return holdingReveal ? "REVEAL" : "RESULT";
    }
    if (activeMatch.status === MATCH_STATUS.PROPOSED)  return "PROPOSED";
    if (activeMatch.status === MATCH_STATUS.ACCEPTED) {
      if (!playerHasPlayed) return "PICK";
      return "LOCK";
    }
    return "IDLE";
  }, [openingTx, activeMatch, holdingReveal, acknowledged, playerHasPlayed]);

  // When the active match is COMPLETED, the cabinet should display the persona
  // / stake from THAT match (the one we just played), not whatever the player
  // is currently dialed to. So derive the "displayed tier/game" from the
  // active match while we're in a fight phase, and fall back to the dial
  // selection in IDLE.
  const displayTier: WagerTier = useMemo(() => {
    if (!activeMatch || phase === "IDLE") return tier;
    return WAGER_TIERS.find(t => t.amountWei === activeMatch.wager) ?? tier;
  }, [activeMatch, phase, tier]);
  const displayGame: GameType = useMemo(() => {
    if (!activeMatch || phase === "IDLE") return game;
    return gameTypeById(activeMatch.gameType) ?? game;
  }, [activeMatch, phase, game]);

  // ─── Actions ─────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);

  async function onChallenge() {
    if (openingTx) return;
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    setOpeningTx(true); setError(null);
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
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      await refetchIds();
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Challenge failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setOpeningTx(false);
    }
  }

  const [submitting, setSubmitting] = useState(false);
  async function onPick(move: number) {
    if (!activeMatch || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
        abi:          ARENA_PLATFORM_ABI,
        functionName: "playMove",
        args:         [activeMatch.id, move],
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      await Promise.all([refetchIds(), refetchPlayer(), refetchAi(), refetchPlayerMove(), refetchAiMove()]);
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Move failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setSubmitting(false);
    }
  }

  // After result, "ack" the match so the cabinet returns to IDLE and the
  // CHALLENGE button rearmes for the next round.
  function onAck() {
    if (!activeMatch) return;
    setAcknowledged(String(activeMatch.id));
  }

  // ─── Derived render data ─────────────────────────────────────────────────
  const youWon = activeMatch?.status === MATCH_STATUS.COMPLETED && !!address
    && activeMatch.winner.toLowerCase() === address.toLowerCase();
  const moves = {
    player: typeof playerMove === "number" ? playerMove : null,
    ai:     typeof aiMove === "number"     ? aiMove     : null,
  };
  const movesEqual = phase === "RESULT" && moves.player !== null && moves.ai !== null && moves.player === moves.ai;
  const tieByRule  = movesEqual && youWon;

  // Per-match recap moves (for the receipt tape).
  const [movesByMatch, setMovesByMatch] = useState<Record<string, { p: number | null; a: number | null }>>({});
  useEffect(() => {
    if (!publicClient || !address || recent.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const calls = recent.flatMap(m => [
          { address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: "playerMoves" as const, args: [m.id, address] },
          { address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: "playerMoves" as const, args: [m.id, aiAddress] },
        ]);
        const res = await publicClient.multicall({ contracts: calls });
        if (cancelled) return;
        const next: Record<string, { p: number | null; a: number | null }> = {};
        recent.forEach((m, i) => {
          next[String(m.id)] = {
            p: res[i * 2    ].status === "success" ? Number(res[i * 2    ].result) : null,
            a: res[i * 2 + 1].status === "success" ? Number(res[i * 2 + 1].result) : null,
          };
        });
        setMovesByMatch(next);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [recent, publicClient, address, aiAddress]);

  // Win streak
  const winStreak = useMemo(() => {
    let s = 0;
    for (const m of recent) {
      if (!address) break;
      if (m.winner.toLowerCase() === address.toLowerCase()) s++; else break;
    }
    return s;
  }, [recent, address]);

  return (
    <div style={{
      minHeight: "100vh",
      background:
        "radial-gradient(ellipse at 50% 0%, rgba(167,139,250,0.18) 0%, transparent 60%), " +
        "linear-gradient(180deg, #07021a 0%, #04001a 100%)",
      paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
    }}>
      {/* Top bar — back · balance/streak */}
      <div style={{
        maxWidth: 480, margin: "0 auto",
        padding: "14px 14px 4px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <CircleBtn label="←" onClick={() => router.push("/games")} />
        <div style={{
          color: displayTier.rim, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.32em",
          animation: "marquee-pulse 2.4s ease-in-out infinite",
        }}>MARKOV-1 · ERC-8004</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {winStreak >= 2 && <StreakChip streak={winStreak} />}
          <BalanceChip balance={gBalance} />
        </div>
      </div>

      {/* CABINET */}
      <div style={{
        maxWidth: 480, margin: "0 auto",
        padding: "8px 12px 0",
      }}>
        <Cabinet
          tier={displayTier}
          game={displayGame}
          phase={phase}
          moves={moves}
          tieByRule={tieByRule}
          youWon={youWon}
          activeWager={activeMatch?.wager ?? null}
          submitting={submitting}
          onPick={onPick}
        />

        {/* Stake + game-type selection (only meaningful in IDLE) */}
        {phase === "IDLE" ? (
          <>
            <StakeStrip tier={tier} onChange={setTier} />
            <GameToggle game={game} onChange={setGame} />
          </>
        ) : (
          <PhaseStatus phase={phase} tier={displayTier} />
        )}

        {/* ACTION BUTTON */}
        <ActionButton
          phase={phase}
          tier={phase === "IDLE" || phase === "RESULT" ? tier : displayTier}
          game={phase === "IDLE" || phase === "RESULT" ? game : displayGame}
          youWon={youWon}
          tieByRule={tieByRule}
          onChallenge={onChallenge}
          onAck={() => { onAck(); onChallenge(); }}
          onAckOnly={onAck}
        />

        {error && (
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5", fontSize: 12, fontWeight: 700, textAlign: "center",
          }}>{error}</div>
        )}
      </div>

      {/* Receipt tape (battle log) */}
      {recent.length > 0 && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "18px 14px 0" }}>
          <ReceiptTape recent={recent} movesByMatch={movesByMatch} address={address} />
        </div>
      )}

      <div style={{
        maxWidth: 480, margin: "0 auto",
        padding: "20px 14px 0",
        color: "rgba(220,210,255,0.4)", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
        textAlign: "center", lineHeight: 1.5,
      }}>
        ERC-8004 verified · Settled on Celo · 🛡️ ties go to you · 5% protocol fee
      </div>
    </div>
  );
}

// ─── Cabinet — the frame + CRT screen ────────────────────────────────────────
function Cabinet({ tier, game, phase, moves, tieByRule, youWon, activeWager, submitting, onPick }: {
  tier: WagerTier;
  game: GameType;
  phase: Phase;
  moves: { player: number | null; ai: number | null };
  tieByRule: boolean;
  youWon: boolean;
  activeWager: bigint | null;
  submitting: boolean;
  onPick: (m: number) => void;
}) {
  const showMoveTray = phase === "PICK";
  const revealing    = phase === "REVEAL";
  const result       = phase === "RESULT";

  return (
    <div style={{
      position: "relative",
      borderRadius: 28,
      padding: "8px 8px 12px",
      background: `linear-gradient(180deg, ${tier.rim}26 0%, rgba(8,2,32,0.95) 12%, rgba(8,2,32,0.95) 88%, ${tier.rim}1a 100%)`,
      border: `1.5px solid ${tier.rim}66`,
      boxShadow: `0 24px 50px -10px ${tier.rim}55, inset 0 1px 0 rgba(255,255,255,0.1)`,
      transition: "border-color 0.3s, box-shadow 0.3s",
    }}>
      {/* Marquee — top thin LED strip */}
      <Marquee tier={tier} game={game} />

      {/* CRT SCREEN */}
      <div style={{
        position: "relative",
        marginTop: 8,
        borderRadius: 20,
        height: 340,
        background: "linear-gradient(180deg, #02000d 0%, #0a0428 100%)",
        border: `2px solid ${tier.rim}55`,
        overflow: "hidden",
        animation: "screen-glow 4.5s ease-in-out infinite, crt-flicker 7s linear infinite",
      }}>
        {/* CRT scanlines */}
        <div aria-hidden style={{
          position: "absolute", inset: 0,
          backgroundImage: "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 3px)",
          pointerEvents: "none",
        }} />
        {/* Slow scan bar */}
        <div aria-hidden style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "100%",
          background: "linear-gradient(180deg, transparent 0%, rgba(167,139,250,0.08) 50%, transparent 100%)",
          pointerEvents: "none",
          animation: "crt-scan 6s linear infinite",
        }} />
        {/* Tier-tinted glow */}
        <div aria-hidden style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(circle at 50% 60%, ${tier.rim}33 0%, transparent 60%)`,
          pointerEvents: "none",
          transition: "background 0.4s",
        }} />

        {/* Stage contents */}
        <div style={{
          position: "relative", zIndex: 1,
          width: "100%", height: "100%",
          display: "flex", flexDirection: "column", alignItems: "center",
          padding: "14px 14px 16px",
        }}>
          {/* Dialogue strip — top */}
          <DialogueStrip tier={tier} phase={phase} youWon={youWon} tieByRule={tieByRule} />

          {/* Persona area */}
          <div style={{
            flex: 1, width: "100%", minHeight: 0,
            position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Persona tier={tier} phase={phase} />

            {/* Win coin rain */}
            {result && youWon && <CoinRain />}

            {/* Loss veil */}
            {result && !youWon && !tieByRule && <LossOverlay />}

            {/* Reveal burst */}
            {revealing && <RevealBurst youWon={youWon} tieByRule={tieByRule} />}

            {/* Move pair (reveal + result) */}
            {(revealing || result) && (
              <MovePair
                gameId={game.id}
                playerMove={moves.player}
                aiMove={moves.ai}
                tierRim={tier.rim}
              />
            )}

            {/* Lock — player picked, AI thinking */}
            {phase === "LOCK" && (
              <div style={{
                position: "absolute", bottom: 6, left: 0, right: 0,
                display: "flex", justifyContent: "center", gap: 14,
                pointerEvents: "none",
              }}>
                <MiniHand emoji={moveDisplay(game.id, moves.player ?? 0).emoji} color="#86efac" label="YOU" />
                <MiniHand emoji="?" color={tier.rim} label="MARKOV" thinking />
              </div>
            )}
          </div>

          {/* Result payout banner — bottom of screen */}
          {result && activeWager !== null && (
            <ResultBanner youWon={youWon} tieByRule={tieByRule} wager={activeWager} tierRim={tier.rim} />
          )}
        </div>
      </div>

      {/* Move tray — rises BELOW the screen, still inside the cabinet */}
      <div style={{ marginTop: 8 }}>
        <MoveTray game={game} onPick={onPick} disabled={submitting} visible={showMoveTray} tierRim={tier.rim} />
      </div>
    </div>
  );
}

// ─── Marquee ─────────────────────────────────────────────────────────────────
function Marquee({ tier, game }: { tier: WagerTier; game: GameType }) {
  return (
    <div style={{
      height: 28, borderRadius: 14,
      background: "linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.4))",
      border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 14px",
    }}>
      <div style={{
        color: tier.rim, fontSize: 9, fontWeight: 900, letterSpacing: "0.22em",
        textShadow: `0 0 6px ${tier.rim}99`,
      }}>{tier.persona.toUpperCase()}</div>
      <div style={{
        color: "rgba(220,210,255,0.7)", fontSize: 9, fontWeight: 800, letterSpacing: "0.22em",
      }}>
        {tier.amount} G$ · {game.shortName}
      </div>
      <div style={{
        color: "rgba(134,239,172,0.85)", fontSize: 9, fontWeight: 900, letterSpacing: "0.22em",
      }}>TIE → YOU</div>
    </div>
  );
}

// ─── Dialogue strip ──────────────────────────────────────────────────────────
function DialogueStrip({ tier, phase, youWon, tieByRule }: {
  tier: WagerTier; phase: Phase; youWon: boolean; tieByRule: boolean;
}) {
  let text = "";
  let color = "rgba(220,210,255,0.85)";
  if (phase === "IDLE")        text = tier.lines.ready;
  else if (phase === "OPENING_TX") text = "Locking your stake…";
  else if (phase === "PROPOSED")   text = `${tier.persona} is matching your wager…`;
  else if (phase === "PICK") {
    text = "Pick your move.";
    color = "#fbbf24";
  } else if (phase === "LOCK") {
    text = `${tier.persona} is reading you…`;
    color = "#67e8f9";
  } else if (phase === "REVEAL") {
    text = "REVEAL!";
    color = "#86efac";
  } else if (phase === "RESULT") {
    text = tieByRule ? tier.lines.tie : youWon ? tier.lines.lose : tier.lines.win;
    color = youWon ? "#86efac" : tieByRule ? "#fde68a" : "#fda4af";
  }

  return (
    <div style={{
      minHeight: 36, width: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "6px 10px",
      borderRadius: 10,
      background: "rgba(0,0,0,0.45)",
      border: "1px solid rgba(255,255,255,0.06)",
      color, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.04em",
      fontStyle: phase === "RESULT" || phase === "IDLE" ? "italic" : "normal",
      textAlign: "center", lineHeight: 1.3,
      animation: "ticker-roll 0.35s ease both",
    }} key={`${phase}-${text}`}>{text}</div>
  );
}

// ─── Persona — character on the CRT ─────────────────────────────────────────
function Persona({ tier, phase }: { tier: WagerTier; phase: Phase }) {
  const [imgOk, setImgOk] = useState(true);
  const lastTierId = useRef(tier.id);
  if (lastTierId.current !== tier.id) {
    lastTierId.current = tier.id;
    if (!imgOk) setImgOk(true);
  }

  // Animation per phase.
  const animation =
    phase === "PROPOSED" ? "persona-step-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) both, persona-breathe 3.2s ease-in-out 0.55s infinite" :
    phase === "LOCK"     ? "persona-breathe 2s ease-in-out infinite, lock-shake 0.6s ease-in-out infinite" :
    phase === "REVEAL"   ? "persona-breathe 3s ease-in-out infinite" :
    phase === "RESULT"   ? "persona-breathe 3.6s ease-in-out infinite" :
                           "persona-breathe 3.2s ease-in-out infinite";

  // During PICK we shrink + move up so move buttons have room visually.
  const inPick = phase === "PICK";

  return (
    <div style={{
      position: "relative",
      width: inPick ? 140 : 200,
      height: inPick ? 140 : 200,
      transform: inPick ? "translateY(-12px)" : "translateY(0)",
      transition: "width 0.35s, height 0.35s, transform 0.35s",
      animation,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {/* Aura */}
      <div aria-hidden style={{
        position: "absolute", inset: -14,
        background: `radial-gradient(circle, ${tier.rim}66 0%, ${tier.rim}11 40%, transparent 72%)`,
        filter: "blur(10px)",
      }} />
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tier.art}
          alt={tier.persona}
          onError={() => setImgOk(false)}
          style={{
            position: "relative", zIndex: 1,
            width: "100%", height: "100%", objectFit: "contain",
            filter: `drop-shadow(0 10px 22px ${tier.rim}cc) drop-shadow(0 0 16px ${tier.rim}88)`,
            ...imgMask,
          }}
        />
      ) : (
        <div style={{
          position: "relative", zIndex: 1,
          fontSize: 120, lineHeight: 1,
          filter: `drop-shadow(0 10px 22px ${tier.rim}cc)`,
        }}>🤖</div>
      )}
    </div>
  );
}

// ─── Move pair (during REVEAL / RESULT) ─────────────────────────────────────
function MovePair({ gameId, playerMove, aiMove, tierRim }: {
  gameId: 0 | 3; playerMove: number | null; aiMove: number | null; tierRim: string;
}) {
  const p = playerMove !== null ? moveDisplay(gameId, playerMove).emoji : "?";
  const a = aiMove     !== null ? moveDisplay(gameId, aiMove).emoji     : "?";
  return (
    <div style={{
      position: "absolute", bottom: 4, left: 0, right: 0,
      display: "flex", justifyContent: "center", gap: 22,
      pointerEvents: "none",
    }}>
      <MiniHand emoji={p} color="#86efac" label="YOU" />
      <MiniHand emoji={a} color={tierRim}  label="MARKOV" />
    </div>
  );
}

function MiniHand({ emoji, color, label, thinking }: {
  emoji: string; color: string; label: string; thinking?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{
        width: 58, height: 58, borderRadius: 14,
        background: `linear-gradient(180deg, ${color}33, rgba(0,0,0,0.4))`,
        border: `1.5px solid ${color}aa`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 0 16px ${color}55`,
        animation: thinking ? "lock-shake 0.7s ease-in-out infinite" : "pick-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        <span style={{ fontSize: 32, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>{emoji}</span>
      </div>
      <div style={{
        color, fontSize: 8, fontWeight: 900, letterSpacing: "0.18em",
        textShadow: `0 0 6px ${color}66`,
      }}>{label}</div>
    </div>
  );
}

// ─── Reveal burst ────────────────────────────────────────────────────────────
function RevealBurst({ youWon, tieByRule }: { youWon: boolean; tieByRule: boolean }) {
  const c = youWon ? "#22c55e" : tieByRule ? "#fbbf24" : "#f43f5e";
  return (
    <>
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle, ${c}55 0%, transparent 60%)`,
        animation: "reveal-burst 0.7s ease-out both",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: "38%", left: "50%", transform: "translate(-50%, -50%)",
        color: c, fontSize: 28, fontWeight: 900, letterSpacing: "0.06em",
        textShadow: `0 0 24px ${c}`,
        animation: "reveal-text 0.6s ease-out both",
        pointerEvents: "none",
      }}>{youWon ? "YOU WIN" : tieByRule ? "TIE — YOURS" : "MARKOV WINS"}</div>
    </>
  );
}

// ─── Coin rain ──────────────────────────────────────────────────────────────
function CoinRain() {
  // 12 coins falling at slight delays and offsets.
  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 2,
    }}>
      {Array.from({ length: 14 }).map((_, i) => (
        <span key={i}
          style={{
            position: "absolute",
            left: `${(i / 14) * 100 + (i % 3) * 4}%`,
            top: 0, fontSize: 18 + (i % 3) * 4,
            animation: `coin-rain ${1.2 + (i % 4) * 0.25}s ease-in ${i * 0.07}s infinite`,
            // @ts-expect-error CSS custom prop
            "--x": `${(i % 5 - 2) * 4}px`,
          }}>🪙</span>
      ))}
    </div>
  );
}

function LossOverlay() {
  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0,
      background: "linear-gradient(180deg, transparent 0%, rgba(244,63,94,0.12) 100%)",
      pointerEvents: "none",
      animation: "fadeIn 0.5s ease both",
    }} />
  );
}

// ─── Result banner ──────────────────────────────────────────────────────────
function ResultBanner({ youWon, tieByRule, wager, tierRim }: {
  youWon: boolean; tieByRule: boolean; wager: bigint; tierRim: string;
}) {
  const prize    = (wager * 2n * 95n) / 100n;
  const prizeStr = Number(formatUnits(prize, 18)).toFixed(2);
  const wagerStr = Number(formatUnits(wager, 18)).toFixed(2);
  const color = youWon ? "#86efac" : tieByRule ? "#fde68a" : "#fda4af";
  const label = youWon ? "VICTORY" : tieByRule ? "STALEMATE" : "DEFEATED";
  const amount = youWon ? `+${prizeStr} G$` : tieByRule ? "stake returned" : `−${wagerStr} G$`;

  return (
    <div style={{
      position: "relative", zIndex: 3,
      marginTop: 6,
      padding: "8px 12px",
      borderRadius: 12,
      background: "rgba(0,0,0,0.55)",
      border: `1px solid ${tierRim}66`,
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      animation: "ticker-roll 0.4s ease both",
    }}>
      <div style={{
        color: "rgba(220,210,255,0.6)", fontSize: 9.5, fontWeight: 900, letterSpacing: "0.22em",
      }}>{label}</div>
      <div style={{
        color, fontSize: 18, fontWeight: 900, lineHeight: 1,
        textShadow: `0 0 14px ${color}55`,
      }}>{amount}</div>
    </div>
  );
}

// ─── MoveTray ────────────────────────────────────────────────────────────────
function MoveTray({ game, onPick, disabled, visible, tierRim }: {
  game: GameType; onPick: (m: number) => void; disabled: boolean; visible: boolean; tierRim: string;
}) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${game.moves.length}, 1fr)`, gap: 8,
      maxHeight: visible ? 130 : 0,
      opacity: visible ? 1 : 0,
      overflow: "hidden",
      transform: visible ? "translateY(0)" : "translateY(20px)",
      transition: "max-height 0.4s, opacity 0.3s, transform 0.4s",
    }}>
      {game.moves.map(m => (
        <button
          key={m.id}
          onClick={() => onPick(m.id)}
          disabled={disabled}
          style={{
            position: "relative", padding: 0, border: "none",
            cursor: disabled ? "wait" : "pointer",
            borderRadius: 14,
            background: `linear-gradient(180deg, ${tierRim}88 0%, ${tierRim}44 100%)`,
            boxShadow: `0 8px 20px -4px ${tierRim}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
            opacity: disabled ? 0.6 : 1,
            transition: "transform 0.12s, opacity 0.12s",
          }}
          onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.animation = "lever-pull 0.25s ease"; }}
          onAnimationEnd={e => { (e.currentTarget as HTMLButtonElement).style.animation = ""; }}
        >
          <div style={{
            borderRadius: 12,
            padding: "12px 6px",
            background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.5) 100%)",
            border: "1.5px solid rgba(255,255,255,0.18)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <span style={{
              fontSize: 30, lineHeight: 1,
              filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.5))",
            }}>{m.emoji}</span>
            <span style={{
              color: "white", fontSize: 9, fontWeight: 900, letterSpacing: "0.14em",
              textShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}>{m.label}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── StakeStrip + GameToggle (IDLE only) ─────────────────────────────────────
function StakeStrip({ tier, onChange }: { tier: WagerTier; onChange: (t: WagerTier) => void }) {
  return (
    <div style={{
      marginTop: 14,
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
    }}>
      {WAGER_TIERS.map(t => {
        const selected = t.id === tier.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t)}
            style={{
              padding: 0, border: "none", cursor: "pointer",
              borderRadius: 14, overflow: "hidden",
              background: "transparent",
              boxShadow: selected
                ? `0 8px 22px -4px ${t.rim}aa, 0 0 0 1.5px ${t.rim}`
                : "0 0 0 1px rgba(255,255,255,0.08)",
              transition: "all 0.18s",
            }}
          >
            <div style={{
              padding: "12px 6px",
              background: selected
                ? `linear-gradient(160deg, ${t.rim}40 0%, rgba(8,2,32,0.85) 70%)`
                : "rgba(20,10,50,0.55)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              minHeight: 64,
            }}>
              <div style={{
                color: selected ? "white" : "rgba(220,210,255,0.65)",
                fontSize: 8.5, fontWeight: 900, letterSpacing: "0.2em",
              }}>{t.difficulty}</div>
              <div style={{
                color: selected ? t.rim : "rgba(220,210,255,0.85)",
                fontSize: 19, fontWeight: 900, lineHeight: 1,
                textShadow: selected ? `0 0 12px ${t.rim}` : "none",
              }}>{t.amount}<span style={{ fontSize: 9.5, marginLeft: 2, opacity: 0.85 }}>G$</span></div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function GameToggle({ game, onChange }: { game: GameType; onChange: (g: GameType) => void }) {
  return (
    <div style={{
      marginTop: 8,
      display: "grid", gridTemplateColumns: `repeat(${GAME_TYPES.length}, 1fr)`, gap: 6,
      padding: 4, borderRadius: 14,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {GAME_TYPES.map(g => {
        const selected = g.id === game.id;
        return (
          <button key={g.id}
            onClick={() => onChange(g)}
            style={{
              padding: "9px 12px", borderRadius: 10, cursor: "pointer",
              background: selected
                ? "linear-gradient(180deg, rgba(167,139,250,0.3) 0%, rgba(99,102,241,0.3) 100%)"
                : "transparent",
              border: selected ? "1px solid rgba(167,139,250,0.6)" : "1px solid transparent",
              color: selected ? "white" : "rgba(220,210,255,0.65)",
              fontWeight: 900, fontSize: 11, letterSpacing: "0.1em",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <span style={{ fontSize: 15 }}>
              {g.moves[0].emoji}{g.moves[1] ? g.moves[1].emoji : ""}
            </span>
            {g.shortName}
          </button>
        );
      })}
    </div>
  );
}

// ─── PhaseStatus (non-IDLE caption strip under the cabinet) ──────────────────
function PhaseStatus({ phase, tier }: { phase: Phase; tier: WagerTier }) {
  const text =
    phase === "OPENING_TX" ? "OPENING…" :
    phase === "PROPOSED"   ? `${tier.persona} LOCKING IN…` :
    phase === "PICK"       ? "PICK A MOVE INSIDE THE CABINET" :
    phase === "LOCK"       ? "WAITING FOR MARKOV-1…" :
    phase === "REVEAL"     ? "REVEAL!" :
                             "MATCH SETTLED";
  return (
    <div style={{
      marginTop: 14,
      padding: "10px 14px", borderRadius: 12,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      color: tier.rim, fontSize: 11, fontWeight: 900, letterSpacing: "0.22em",
      textAlign: "center",
    }}>{text}</div>
  );
}

// ─── ActionButton — the cabinet's lever ──────────────────────────────────────
function ActionButton({ phase, tier, game, youWon, tieByRule, onChallenge, onAck, onAckOnly }: {
  phase: Phase; tier: WagerTier; game: GameType;
  youWon: boolean; tieByRule: boolean;
  onChallenge: () => void;
  onAck: () => void;        // ack current result + immediately fire a new challenge
  onAckOnly: () => void;    // ack current result without firing a new challenge
}) {
  const hidden = phase === "PICK" || phase === "REVEAL";
  if (hidden) return <div style={{ height: 8 }} />;

  if (phase === "RESULT") {
    return (
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <LeverButton
          tier={tier}
          label={`▶ REMATCH · ${tier.amount} G$ · ${game.shortName}`}
          subLabel={youWon ? "Keep the streak going" : tieByRule ? "Run it back" : "Avenge yourself"}
          onClick={onAck}
        />
        <button onClick={onAckOnly} style={{
          padding: 10, borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(220,210,255,0.7)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em",
          cursor: "pointer",
        }}>NEW STAKE / GAME</button>
      </div>
    );
  }

  const label =
    phase === "IDLE"        ? `▶ TAP TO CHALLENGE · ${tier.amount} G$ · ${game.shortName}` :
    phase === "OPENING_TX"  ? "OPENING…" :
    phase === "PROPOSED"    ? `MARKOV LOCKING IN ${tier.amount} G$…` :
    phase === "LOCK"        ? "WAITING FOR MARKOV…" :
                              "…";
  const sub =
    phase === "IDLE" ? "winner takes the pot · 5% protocol fee" :
    phase === "OPENING_TX" ? "Approve in your wallet" :
    phase === "PROPOSED" ? "AI accepts in ~10s" :
    phase === "LOCK" ? "Your move is on-chain. Reveal incoming." :
    "";

  return (
    <div style={{ marginTop: 14 }}>
      <LeverButton
        tier={tier}
        label={label}
        subLabel={sub}
        onClick={phase === "IDLE" ? onChallenge : undefined}
        disabled={phase !== "IDLE"}
      />
    </div>
  );
}

function LeverButton({ tier, label, subLabel, onClick, disabled }: {
  tier: WagerTier; label: string; subLabel: string;
  onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: "100%", padding: 0, border: "none",
        cursor: disabled ? "default" : "pointer",
        borderRadius: 18, overflow: "hidden",
        background: `linear-gradient(180deg, ${tier.rim} 0%, ${tier.rim}cc 100%)`,
        boxShadow: `0 14px 30px -6px ${tier.rim}cc, inset 0 1px 0 rgba(255,255,255,0.5)`,
        opacity: disabled ? 0.78 : 1,
        transition: "transform 0.1s, opacity 0.15s",
      }}
      onMouseDown={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
    >
      <div style={{
        padding: "16px 18px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0.18) 100%)",
        color: "#04001a",
      }}>
        <div style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: "0.14em", lineHeight: 1 }}>
          {label}
        </div>
        {subLabel && (
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", marginTop: 5, opacity: 0.75 }}>
            {subLabel}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Receipt tape — battle log under the cabinet ────────────────────────────
function ReceiptTape({ recent, movesByMatch, address }: {
  recent: ArenaMatch[];
  movesByMatch: Record<string, { p: number | null; a: number | null }>;
  address?: string;
}) {
  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 6px), rgba(255,255,255,0.03)",
      border: "1px dashed rgba(255,255,255,0.1)",
    }}>
      <div style={{
        padding: "8px 14px",
        borderBottom: "1px dashed rgba(255,255,255,0.08)",
        color: "rgba(220,210,255,0.5)", fontSize: 9, fontWeight: 900, letterSpacing: "0.3em",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>BATTLE LOG</span>
        <span>LAST {recent.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {recent.map(m => {
          const tier = WAGER_TIERS.find(t => t.amountWei === m.wager) ?? WAGER_TIERS[1];
          const mv = movesByMatch[String(m.id)];
          const youWon = !!address && m.winner.toLowerCase() === address.toLowerCase();
          const wager = Number(formatUnits(m.wager, 18)).toFixed(2);
          const payout = youWon ? `+${(parseFloat(wager) * 1.9).toFixed(2)}` : `−${wager}`;
          const playerEmoji = mv?.p !== null && mv?.p !== undefined ? moveDisplay(m.gameType as 0 | 3, mv.p).emoji : "?";
          const aiEmoji     = mv?.a !== null && mv?.a !== undefined ? moveDisplay(m.gameType as 0 | 3, mv.a).emoji : "?";
          return (
            <div key={String(m.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "8px 12px",
                borderBottom: "1px dashed rgba(255,255,255,0.06)",
              }}>
              <PersonaThumb tier={tier} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: "white", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em",
                }}>{tier.persona}</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 5, marginTop: 2,
                  color: "rgba(220,210,255,0.85)",
                }}>
                  <span style={{ fontSize: 14 }}>{playerEmoji}</span>
                  <span style={{ color: "rgba(220,210,255,0.35)", fontSize: 9, fontWeight: 900, letterSpacing: "0.16em" }}>vs</span>
                  <span style={{ fontSize: 14 }}>{aiEmoji}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{
                  color: youWon ? "#86efac" : "#fca5a5",
                  fontSize: 12, fontWeight: 900,
                }}>{payout} G$</div>
                <div style={{
                  color: youWon ? "rgba(134,239,172,0.55)" : "rgba(252,165,165,0.5)",
                  fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em", marginTop: 1,
                }}>{youWon ? "WON" : "LOST"} · #{String(m.id)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonaThumb({ tier }: { tier: WagerTier }) {
  return (
    <div style={{
      flexShrink: 0, position: "relative",
      width: 40, height: 40,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        position: "absolute", inset: -2,
        background: `radial-gradient(circle, ${tier.rim}66 0%, transparent 70%)`,
        filter: "blur(6px)",
      }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={tier.art} alt="" style={{
        position: "relative", zIndex: 1,
        width: "100%", height: "100%", objectFit: "contain",
        filter: `drop-shadow(0 2px 5px ${tier.rim}aa)`,
        ...imgMask,
      }} />
    </div>
  );
}

// ─── Top-bar chips ───────────────────────────────────────────────────────────
function CircleBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: 36, height: 36, borderRadius: 999,
      background: "rgba(0,0,0,0.45)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(6px)",
    }}>{label}</button>
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
      <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 900 }}>{streak}</span>
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

// ─── Helpers ────────────────────────────────────────────────────────────────
function wagerTierFromAmount(wei: bigint): WagerTierId {
  for (const t of WAGER_TIERS) {
    if (t.amountWei === wei) return t.id;
  }
  return "staked";
}

// Suppress unused-warning for tauntFor — it stays in lib for future use.
void tauntFor;
