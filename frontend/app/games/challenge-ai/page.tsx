"use client";

// ─── /games/challenge-ai ──────────────────────────────────────────────────────
// Single-page Challenge AI experience, ported from the claude.ai/design v3
// handoff (hero-panel + selector + cinematic VS + ceremonial result).
//
// Phases (all in this file, no routing):
//   lobby   — focused HeroPanel + SelectorRail + stake row + recent fights
//   vs      — 3-phase cinematic: player slides in → AI slides in → VS slams
//   match   — single round on-chain. Combatant stages + RPS / Coin buttons +
//             tactical hint. While the AI is locking in, the AI portrait shows
//             a spinning dashed "thinking" ring.
//   result  — coin-on-win or persona-on-loss hero, payout counter, single-
//             round move strip, updated record vs this opponent, REMATCH CTA
//
// On-chain reality:
//   - There is only ONE MARKOV-1 agent on the contract. The three "personas"
//     are visual fronts driven by the wager amount the player picks. When
//     ENTER ARENA fires, we transferAndCall with the tier's amountWei and
//     route into the VS sting.
//   - Resume on direct URL: if there's already an active (non-cancelled) match
//     on getPlayerMatches when the page mounts, we skip the lobby and land in
//     the correct phase for that match.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { encodeAbiParameters, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC20_ABI } from "@/lib/contracts";
import {
  GAME_TYPES, WAGER_TIERS, MATCH_STATUS,
  GAME_TYPE_COIN,
  gameTypeById, moveDisplay,
  type ArenaMatch, type GameType, type WagerTier,
} from "@/lib/challengeAi";

// Image mask — softens any visible rectangular background behind a character
// image. Transparent PNGs ignore it; JPEG fallbacks fade cleanly at the edges.
const imgMask = {
  WebkitMaskImage: "radial-gradient(circle at 50% 45%, black 56%, transparent 82%)",
  maskImage:       "radial-gradient(circle at 50% 45%, black 56%, transparent 82%)",
};

type Phase = "lobby" | "vs" | "match" | "result";

// ─── Player pet — mirrors the data from /games/{simon,rhythm}/page.tsx ──────
// Pet stage drives the player avatar everywhere we'd otherwise show a 🧑
// emoji (VS sting intro, combatant portrait, tie face on result).
type PetStage = { id: string; name: string; src: string; minLevel: number; color: string };
const PET_STAGES: PetStage[] = [
  { id: "egg",     name: "Mystery Egg",   src: "/pets/stage-1-egg.png",     minLevel: 1,  color: "#e2e8f0" },
  { id: "baby",    name: "Baby Slime",    src: "/pets/stage-2-baby.png",    minLevel: 5,  color: "#22c55e" },
  { id: "teen",    name: "Teen Slime",    src: "/pets/stage-3-teen.png",    minLevel: 15, color: "#a78bfa" },
  { id: "crystal", name: "Crystal Slime", src: "/pets/stage-4-crystal.png", minLevel: 30, color: "#06b6d4" },
  { id: "king",    name: "King Slime",    src: "/pets/stage-5-king.png",    minLevel: 50, color: "#fbbf24" },
];
function petForLevel(level: number): PetStage {
  let stage = PET_STAGES[0]!;
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3005";

function usePlayerPet(address: `0x${string}` | undefined): PetStage {
  const [level, setLevel] = useState(1);
  useEffect(() => {
    if (!address) return;
    fetch(`${BACKEND_URL}/api/user/${address}`)
      .then(r => r.json())
      .then(d => setLevel(d.level || 1))
      .catch(() => {});
  }, [address]);
  return petForLevel(level);
}

// Viewport hook — keeps the layout in sync on resize without spamming renders.
// 760px breakpoint matches the design's mobile/desktop split.
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 760px)");
    const handler = () => setIsDesktop(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

// Agent staleness — if the on-chain match is sitting in PROPOSED with no
// acceptance for > 30s, or in ACCEPTED with player moved + AI still waiting
// for > 20s, we treat the agent as offline and surface that to the player.
function useAgentStale(activeMatch: ArenaMatch | null, playerHasPlayed: boolean, aiHasPlayed: boolean): {
  proposedStale: boolean;
  lockStale: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 2000);
    return () => clearInterval(i);
  }, []);
  if (!activeMatch) return { proposedStale: false, lockStale: false };
  const ageSec = Date.now() / 1000 - Number(activeMatch.createdAt);
  if (activeMatch.status === MATCH_STATUS.PROPOSED) {
    return { proposedStale: ageSec > 30, lockStale: false };
  }
  if (activeMatch.status === MATCH_STATUS.ACCEPTED && playerHasPlayed && !aiHasPlayed) {
    // Use createdAt + some baseline; not perfect since we don't have move
    // timestamp on-chain, but >60s total age past your move is a strong signal.
    return { proposedStale: false, lockStale: ageSec > 60 };
  }
  return { proposedStale: false, lockStale: false };
}

// ─── useAgentLiveness ───────────────────────────────────────────────────────
// Pre-challenge gate: is MARKOV's off-chain agent process actually running?
//
// We use on-chain state as a proxy, not a heartbeat endpoint — that way we
// don't need new infra and the check works regardless of where the agent is
// deployed. Two signals combined:
//   1. The MOST RECENT global match on the contract. If it's been in PROPOSED
//      status for > 45s, the agent didn't accept it — process is dead.
//   2. The agent wallet's G$ balance. If it can't fund the smallest tier
//      (0.1 G$), it's out of money even if the process is alive.
//
// Polled every 5s. Conservative defaults so a brand-new contract reads as
// "online" until proven otherwise.
function useAgentLiveness(): { online: boolean; reason: "offline" | "out-of-funds" | "online" | "unknown" } {
  // Latest global match id.
  const { data: counterRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "matchCounter",
    query: { refetchInterval: 5000 },
  });
  const latestId = counterRaw ? (counterRaw as bigint) : 0n;

  const { data: latestMatchTuple } = useReadContract({
    address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`,
    abi: ARENA_PLATFORM_ABI,
    functionName: "matches",
    args: [latestId],
    query: { enabled: latestId > 0n, refetchInterval: 5000 },
  });

  // Agent's G$ balance — must cover at least the warmup tier (0.1 G$ = 1e17).
  const { data: agentBalanceRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`],
    query: { refetchInterval: 15000 },
  });

  // Force re-evaluation every 3s so the time-based check stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 3000);
    return () => clearInterval(i);
  }, []);

  return useMemo(() => {
    // Out-of-funds check is unambiguous — block challenge regardless.
    if (agentBalanceRaw != null) {
      const bal = agentBalanceRaw as bigint;
      if (bal < 10n ** 17n) return { online: false, reason: "out-of-funds" as const };
    }
    // Brand-new contract — no signal to judge from, assume online.
    if (latestId === 0n || !latestMatchTuple) return { online: true, reason: "online" as const };

    const t = latestMatchTuple as unknown as readonly [bigint, `0x${string}`, `0x${string}`, bigint, number, number, `0x${string}`, bigint];
    const challenger = t[1];
    const status = t[5];
    const createdAt = Number(t[7]);

    // Ghost slot — matchCounter incremented but no match struct was
    // actually written (createdAt == 0 + zero-address challenger). The
    // contract returns the default zero tuple. Don't false-positive a
    // ~56-year age against the unix epoch; treat as "no signal".
    if (createdAt === 0 || challenger === "0x0000000000000000000000000000000000000000") {
      return { online: true, reason: "online" as const };
    }

    const ageSec = Date.now() / 1000 - createdAt;

    // Latest match still PROPOSED + old = agent didn't accept = process down.
    if (status === MATCH_STATUS.PROPOSED && ageSec > 45) {
      return { online: false, reason: "offline" as const };
    }
    return { online: true, reason: "online" as const };
  }, [agentBalanceRaw, latestId, latestMatchTuple]);
}

export default function ChallengeAi() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const isDesktop = useIsDesktop();
  const pet = usePlayerPet(address as `0x${string}` | undefined);
  const agentLiveness = useAgentLiveness();

  // ─── Selection ───────────────────────────────────────────────────────────
  const [tier, setTier] = useState<WagerTier>(WAGER_TIERS[1]);
  const [game, setGame] = useState<GameType>(GAME_TYPES[0]);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [error, setError] = useState<string | null>(null);
  // Two gates for VS → match transition:
  //   - vsCinematicDone: the FIGHT reveal has had ~2.8s on screen.
  //   - the on-chain match has reached ACCEPTED (AI agent took the challenge).
  // We only flip to "match" when both are true so the player never sees a
  // blank/waiting picker between the cinematic and the actual game.
  const [vsCinematicDone, setVsCinematicDone] = useState(false);

  // ─── Wallet + chain reads ────────────────────────────────────────────────
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

  const [matches, setMatches] = useState<ArenaMatch[]>([]);
  // Ticker to force the multicall to re-run on a fixed interval. Without
  // this, the effect only re-fires when matchIds changes — which means
  // STATUS changes on existing matches (e.g. PROPOSED → ACCEPTED → COMPLETED
  // as the agent processes them) never propagate to the UI and the
  // staleness banner mis-fires on matches the agent has already accepted.
  const [matchesTick, setMatchesTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setMatchesTick(t => t + 1), 4000);
    return () => clearInterval(i);
  }, []);
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
  }, [matchIds, publicClient, matchesTick]);

  // Active match = most recent non-cancelled match.
  const activeMatch = useMemo(() =>
    matches.find(m => m.status !== MATCH_STATUS.CANCELLED) ?? null,
    [matches],
  );

  // On mount, if we land on the page WITH an in-flight match, skip the lobby.
  // Dismissed-match guard. When the player taps Pick-another-AI / REMATCH
  // (or hits the page on a stale completed match), the match id gets added
  // here and every effect / render that would resume or replay that match
  // bails out.
  //
  // CRITICAL: the lookup is backed by a useRef, not state. When
  // activeMatch flips on mount, BOTH the resume-on-mount and the
  // auto-result effects fire on the same batch. State updates queued by
  // dismissMatch in resume-on-mount don't apply until the next render, so
  // if auto-result reads from React state, it sees the old dismissed set
  // and proceeds to schedule setPhase('result') anyway. A ref is updated
  // synchronously by dismissMatch, so the in-batch effect order does the
  // right thing: resume fires → marks the match dismissed → auto-result
  // fires immediately after and reads the updated ref → skips.
  //
  // The state alongside the ref is purely so React re-renders correctly
  // when dismissals propagate to UI (e.g. the lobby's recent-fights
  // strip needs to recompute).
  const dismissedRef = useRef<Set<string>>(new Set());
  const [, setDismissedTick] = useState(0);
  const dismissMatch = (m: ArenaMatch | null) => {
    if (!m) return;
    dismissedRef.current.add(String(m.id));
    setDismissedTick(t => t + 1);
  };
  const isDismissed = (m: ArenaMatch | null) => !!m && dismissedRef.current.has(String(m.id));

  // Resume from URL — drives the refreshing-mid-match behavior. Only fires
  // once on mount per active match. Three branches:
  //   - in-progress (PROPOSED or ACCEPTED): resume into the match phase.
  //   - COMPLETED: auto-dismiss + stay on lobby. Don't drag the player back
  //     into the result screen of a match they already saw — that's stale.
  //     The visible-on-result-completion flow is handled by the separate
  //     auto-result effect below (which only fires for status transitions
  //     happening while the user is on this page).
  //   - already dismissed: no-op.
  const armedRef = useRef(false);
  useEffect(() => {
    if (armedRef.current || !activeMatch || isDismissed(activeMatch)) return;
    armedRef.current = true;
    if (activeMatch.status === MATCH_STATUS.COMPLETED) {
      // Stale completed match from a previous session — silently dismiss
      // and stay on the lobby. The player came here to start fresh.
      dismissMatch(activeMatch);
      return;
    }
    setPhase("match");
    const matchedTier = WAGER_TIERS.find(t => t.amountWei === activeMatch.wager);
    if (matchedTier) setTier(matchedTier);
    const matchedGame = gameTypeById(activeMatch.gameType);
    if (matchedGame) setGame(matchedGame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch]);

  // ─── Active match move + hasPlayed reads ────────────────────────────────
  const matchId = activeMatch?.id ?? 0n;
  const matchEnabled = matchId > 0n && !!address;
  const aiAddress = CONTRACT_ADDRESSES.AI_AGENT as `0x${string}`;

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

  // Per-match local mirror — tagged with the match id it was captured for.
  //
  // The previous untagged version still flashed stale data for one render:
  // when activeMatch.id flips to the new match, mirror state hasn't been
  // reset yet (state changes happen between renders via useEffect). So the
  // OLD match's playerHasPlayed=true + the OLD playerMove/aiMove values
  // briefly rendered against the NEW activeMatch — UI showed "TIE" before
  // the player had even moved.
  //
  // Fix: each mirror stores { id, value }. We expose a `safe` reading that
  // returns the neutral default whenever the mirror's id doesn't match the
  // current activeMatch.id. So even on the one-render gap before the next
  // useEffect runs, the mirror evaluates to null/false. No stale leakage.
  const [phpMirrorState, setPhpMirrorState] = useState<{ id: bigint | null; v: boolean }>({ id: null, v: false });
  const [ahpMirrorState, setAhpMirrorState] = useState<{ id: bigint | null; v: boolean }>({ id: null, v: false });
  const [pmMirrorState,  setPmMirrorState]  = useState<{ id: bigint | null; v: number | null }>({ id: null, v: null });
  const [amMirrorState,  setAmMirrorState]  = useState<{ id: bigint | null; v: number | null }>({ id: null, v: null });
  useEffect(() => {
    if (typeof playerHasPlayed === "boolean" && activeMatch?.id !== undefined) {
      setPhpMirrorState({ id: activeMatch.id, v: playerHasPlayed });
    }
  }, [playerHasPlayed, activeMatch?.id]);
  useEffect(() => {
    if (typeof aiHasPlayed === "boolean" && activeMatch?.id !== undefined) {
      setAhpMirrorState({ id: activeMatch.id, v: aiHasPlayed });
    }
  }, [aiHasPlayed, activeMatch?.id]);
  useEffect(() => {
    if (typeof playerMove === "number" && activeMatch?.id !== undefined) {
      setPmMirrorState({ id: activeMatch.id, v: playerMove });
    }
  }, [playerMove, activeMatch?.id]);
  useEffect(() => {
    if (typeof aiMove === "number" && activeMatch?.id !== undefined) {
      setAmMirrorState({ id: activeMatch.id, v: aiMove });
    }
  }, [aiMove, activeMatch?.id]);
  const currentId = activeMatch?.id;
  // Stale guard — even if a mirror IS valid for the current activeMatch.id,
  // if that match has been dismissed (player tapped Pick-another-AI /
  // REMATCH and we're waiting for the new match to show up on chain), we
  // shouldn't surface ANY of its data. That was the source of the lingering
  // "TIE" / stale-pre-game flash: phase already transitioned to 'match' but
  // activeMatch was briefly still the OLD dismissed completed match, and
  // CombatantStage's `completed && aiMove` condition rendered the old
  // hand. Force-null these to keep the UI in a clean placeholder state
  // until the new match's data arrives.
  const stale = !!activeMatch && isDismissed(activeMatch);
  const phpMirror = !stale && phpMirrorState.id === currentId ? phpMirrorState.v : false;
  const ahpMirror = !stale && ahpMirrorState.id === currentId ? ahpMirrorState.v : false;
  const pmMirror  = !stale && pmMirrorState.id  === currentId ? pmMirrorState.v  : null;
  const amMirror  = !stale && amMirrorState.id  === currentId ? amMirrorState.v  : null;

  // Agent staleness — if MARKOV doesn't accept / play within the expected
  // window, the agent process is probably offline. Surface that honestly.
  const { proposedStale, lockStale } = useAgentStale(activeMatch, phpMirror, ahpMirror);

  // ─── Hold-reveal: after status=COMPLETED, hold the REVEAL animation briefly
  // before dropping into RESULT, and double-refetch the moves to win the RPC
  // race (forno load-balancer can serve a stale read after a finalized block).
  const [holdingReveal, setHoldingReveal] = useState(false);
  const revealHoldStartRef = useRef<bigint | null>(null);
  useEffect(() => {
    if (!activeMatch || activeMatch.status !== MATCH_STATUS.COMPLETED) return;
    if (isDismissed(activeMatch)) return; // player already dismissed this match
    if (revealHoldStartRef.current === activeMatch.id) return;
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

    const ms = tier.id === "highroller" ? 2000 : tier.id === "staked" ? 1700 : 1400;
    const t = setTimeout(() => {
      setHoldingReveal(false);
      // Drop from match phase to result phase after the reveal beat.
      setPhase("result");
    }, ms);
    return () => { cancelled = true; clearTimeout(t); };
  }, [activeMatch?.id, activeMatch?.status, tier.id, refetchPlayerMove, refetchAiMove, activeMatch]);

  // VS → match gate. Hold on the cinematic until BOTH:
  //   - cinematic minimum playback elapsed (vsCinematicDone)
  //   - the freshly-created match has reached ACCEPTED on-chain (AI agent
  //     took the challenge — the picker won't work before this).
  // Hard fallback at 15s so the player is never stuck on VS if the agent
  // is slow/down. An error in onChallenge would already have flipped phase
  // away from "vs", so this only runs on the happy path.
  useEffect(() => {
    if (phase !== "vs") return;
    const isFreshAccepted = !!activeMatch
      && activeMatch.status === MATCH_STATUS.ACCEPTED
      && !!address
      && activeMatch.challenger.toLowerCase() === address.toLowerCase()
      && activeMatch.wager === tier.amountWei;
    if (vsCinematicDone && isFreshAccepted) {
      setPhase("match");
      return;
    }
    const cap = setTimeout(() => {
      setPhase("match");
    }, 15000);
    return () => clearTimeout(cap);
  }, [phase, vsCinematicDone, activeMatch, address, tier.amountWei]);

  // ─── Per-tier history (record + tactical hint) ──────────────────────────
  // Compute wins/losses against each tier from the player's match history.
  // The hint pulls the most-recent 3 moves vs the focused tier on each side.
  const completed = useMemo(() => matches.filter(m => m.status === MATCH_STATUS.COMPLETED), [matches]);

  const records = useMemo(() => {
    const r: Record<string, { wins: number; losses: number; streak: number }> = {};
    for (const t of WAGER_TIERS) r[t.id] = { wins: 0, losses: 0, streak: 0 };
    if (!address) return r;
    // Iterate from newest to oldest so the streak terminates at the first non-win.
    let streakClosedFor: Record<string, boolean> = {};
    for (const m of completed) {
      const t = WAGER_TIERS.find(t => t.amountWei === m.wager);
      if (!t) continue;
      const won = m.winner.toLowerCase() === address.toLowerCase();
      if (won) r[t.id].wins++;
      else     r[t.id].losses++;
      if (!streakClosedFor[t.id]) {
        if (won) r[t.id].streak++;
        else     streakClosedFor[t.id] = true;
      }
    }
    return r;
  }, [completed, address]);

  // Pull last-3 moves per tier for the tactical hint. Single multicall over
  // the most-recent 3 completed matches per tier (capped at 9).
  const [movesByMatch, setMovesByMatch] = useState<Record<string, { p: number | null; a: number | null }>>({});
  useEffect(() => {
    if (!publicClient || !address || completed.length === 0) return;
    const sampleIds = completed.slice(0, 15);
    let cancelled = false;
    (async () => {
      try {
        const calls = sampleIds.flatMap(m => [
          { address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: "playerMoves" as const, args: [m.id, address] },
          { address: CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, abi: ARENA_PLATFORM_ABI, functionName: "playerMoves" as const, args: [m.id, aiAddress] },
        ]);
        const res = await publicClient.multicall({ contracts: calls });
        if (cancelled) return;
        const next: Record<string, { p: number | null; a: number | null }> = {};
        sampleIds.forEach((m, i) => {
          next[String(m.id)] = {
            p: res[i * 2    ].status === "success" ? Number(res[i * 2    ].result) : null,
            a: res[i * 2 + 1].status === "success" ? Number(res[i * 2 + 1].result) : null,
          };
        });
        setMovesByMatch(next);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [completed, publicClient, address, aiAddress]);

  // Last 3 picks against the FOCUSED tier — used for tactical hint in match phase.
  const tierHistory = useMemo(() => {
    const player: number[] = [];
    const ai: number[] = [];
    for (const m of completed) {
      if (m.wager !== tier.amountWei) continue;
      const mv = movesByMatch[String(m.id)];
      if (!mv) continue;
      if (mv.p !== null) player.push(mv.p);
      if (mv.a !== null) ai.push(mv.a);
      if (player.length >= 3 && ai.length >= 3) break;
    }
    return { player: player.slice(0, 3), ai: ai.slice(0, 3) };
  }, [completed, movesByMatch, tier.amountWei]);

  // ─── Actions ─────────────────────────────────────────────────────────────
  const [submittingChallenge, setSubmittingChallenge] = useState(false);
  const [submittingMove, setSubmittingMove] = useState(false);

  async function onChallenge() {
    if (submittingChallenge) return;
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
    setSubmittingChallenge(true); setError(null);
    try {
      const encoded = encodeAbiParameters(
        [{ type: "uint8" }, { type: "address" }, { type: "uint8" }],
        [0, aiAddress, game.id],
      );
      const hash = await writeContractAsync({
        address:      CONTRACT_ADDRESSES.G_TOKEN as `0x${string}`,
        abi:          ERC20_ABI,
        functionName: "transferAndCall",
        args:         [CONTRACT_ADDRESSES.ARENA_PLATFORM as `0x${string}`, tier.amountWei, encoded],
      });
      if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      await refetchIds();
      // Kick into the VS sting. Don't blindly time out into match — the
      // chain match isn't ACCEPTED yet until the AI agent picks up the
      // event. A separate effect transitions to "match" once both gates
      // open: cinematic minimum elapsed AND match is ACCEPTED on-chain.
      setVsCinematicDone(false);
      setPhase("vs");
      setTimeout(() => setVsCinematicDone(true), 2800);
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
              ?? (e as { message?: string })?.message
              ?? "Challenge failed";
      setError(msg.length > 140 ? msg.slice(0, 140) + "…" : msg);
    } finally {
      setSubmittingChallenge(false);
    }
  }

  async function onPick(move: number) {
    if (!activeMatch || submittingMove) return;
    setSubmittingMove(true); setError(null);
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
      setSubmittingMove(false);
    }
  }

  // Both dismissal paths add the completed match to the dismissed set so
  // neither the resume-on-mount nor the auto-result effects can replay
  // it. armedRef stays true so resume-on-mount stays dormant for the
  // rest of this session.
  async function onRematch() {
    dismissMatch(activeMatch);
    await onChallenge();
  }
  function onLobby() {
    dismissMatch(activeMatch);
    setPhase("lobby");
  }

  // ─── Derived for sub-screens ─────────────────────────────────────────────
  const youWon = activeMatch?.status === MATCH_STATUS.COMPLETED && !!address
    && activeMatch.winner.toLowerCase() === address.toLowerCase();
  const movesEqual = phase === "result" && pmMirror !== null && amMirror !== null && pmMirror === amMirror;
  const tieByRule = movesEqual && youWon;

  // Win streak chip in the top bar — sum of streaks across all tiers (latest
  // run of wins, regardless of tier).
  const overallStreak = useMemo(() => {
    if (!address) return 0;
    let s = 0;
    for (const m of completed) {
      if (m.winner.toLowerCase() === address.toLowerCase()) s++;
      else break;
    }
    return s;
  }, [completed, address]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: "#04001a",
      overflow: "hidden",
      paddingBottom: "calc(60px + env(safe-area-inset-bottom))",
    }}>
      {/* Arena floor — opacity varies with phase */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/games/challenge-ai-v2/ai-arena.png" alt="" style={{
        position: "fixed", inset: 0, width: "100%", height: "100%",
        objectFit: "cover", pointerEvents: "none", zIndex: 0,
        opacity: phase === "lobby" ? 0.18 : phase === "match" ? 0.42 : phase === "vs" ? 0.05 : 0.22,
        transition: "opacity 0.6s ease",
      }} />
      <div aria-hidden style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(4,0,26,0.65) 0%, transparent 28%, transparent 62%, rgba(4,0,26,0.92) 100%)",
      }} />

      {/* Close button */}
      <button onClick={() => router.push("/games")} title="Leave arena" style={{
        position: "absolute", top: 14, left: 14, zIndex: 30,
        width: 36, height: 36, borderRadius: 999, cursor: "pointer",
        background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)",
        color: "white", fontSize: 17, fontWeight: 900,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(8px)",
      }}>×</button>

      {/* Top-right context chips */}
      <div style={{
        position: "absolute", top: 14, right: 14, zIndex: 30,
        display: "flex", gap: 8, alignItems: "center",
      }}>
        {overallStreak >= 2 && <StreakChip streak={overallStreak} />}
        <BalanceChip balance={gBalance} />
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        {phase === "lobby" && (
          <ArenaLobby
            tier={tier} setTier={setTier}
            game={game} setGame={setGame}
            records={records}
            matches={matches}
            onStart={onChallenge}
            busy={submittingChallenge}
            error={error}
            isDesktop={isDesktop}
            agentLiveness={agentLiveness}
          />
        )}
        {phase === "vs" && <ArenaVS tier={tier} game={game} pet={pet} />}
        {phase === "match" && (
          <ArenaMatch
            tier={tier}
            game={game}
            pet={pet}
            activeMatch={activeMatch}
            playerHasPlayed={phpMirror}
            aiHasPlayed={ahpMirror}
            playerMove={pmMirror}
            aiMove={amMirror}
            holdingReveal={holdingReveal}
            tierHistory={tierHistory}
            onPick={onPick}
            submitting={submittingMove}
            youWon={youWon}
            error={error}
            proposedStale={proposedStale}
            lockStale={lockStale}
            onLobby={onLobby}
          />
        )}
        {phase === "result" && activeMatch && (
          <ArenaResult
            tier={tier}
            game={game}
            pet={pet}
            wager={activeMatch.wager}
            youWon={youWon}
            tieByRule={tieByRule}
            playerMove={pmMirror}
            aiMove={amMirror}
            record={records[tier.id] ?? { wins: 0, losses: 0, streak: 0 }}
            onAgain={onRematch}
            onLobby={onLobby}
            busy={submittingChallenge}
          />
        )}
      </div>
    </div>
  );
}

// ─── ArenaLobby ──────────────────────────────────────────────────────────────
function ArenaLobby({ tier, setTier, game, setGame, records, matches, onStart, busy, error, isDesktop, agentLiveness }: {
  tier: WagerTier; setTier: (t: WagerTier) => void;
  game: GameType; setGame: (g: GameType) => void;
  records: Record<string, { wins: number; losses: number; streak: number }>;
  matches: ArenaMatch[];
  onStart: () => void;
  busy: boolean;
  error: string | null;
  isDesktop: boolean;
  agentLiveness: { online: boolean; reason: "offline" | "out-of-funds" | "online" | "unknown" };
}) {
  const record = records[tier.id] ?? { wins: 0, losses: 0, streak: 0 };
  const total = record.wins + record.losses;
  const winrate = total === 0 ? null : Math.round((record.wins / total) * 100);
  const payout = (parseFloat(tier.amount) * tier.multi).toFixed(2);
  const ubiSplit = (parseFloat(tier.amount) * 0.3).toFixed(2);

  return (
    <div style={{
      maxWidth: isDesktop ? 1080 : 540, margin: "0 auto",
      padding: isDesktop ? "70px 32px 28px" : "60px 14px 20px",
      display: "flex", flexDirection: "column", gap: isDesktop ? 18 : 14,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "4px 11px", borderRadius: 999,
          fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em",
          background: "rgba(251,191,36,0.14)",
          border: "1px solid rgba(251,191,36,0.4)",
          color: "#fbbf24",
        }}>🤖 PVE · CHALLENGE AI</div>
        <h1 style={{
          color: "white", fontSize: 26, fontWeight: 900, lineHeight: 1.1,
          margin: "10px 0 4px",
          letterSpacing: "-0.01em",
          textShadow: "0 4px 22px rgba(167,139,250,0.45)",
        }}>Challenge {tier.persona}</h1>
        <p style={{
          color: "rgba(220,210,255,0.65)", fontSize: 12, lineHeight: 1.45,
          margin: 0, maxWidth: 380, marginLeft: "auto", marginRight: "auto",
        }}>
          Single round on Celo. Tie goes to you. Winner takes 1.96× the pot (2% protocol fee).
        </p>
      </div>

      {/* HERO PANEL + SELECTOR RAIL — side-by-side on desktop, stacked on mobile */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isDesktop ? "1.4fr 1fr" : "1fr",
        gap: isDesktop ? 18 : 12,
        alignItems: "stretch",
      }}>
        <HeroPanel tier={tier} record={record} winrate={winrate} isDesktop={isDesktop} />
        <SelectorRail tier={tier} setTier={setTier} records={records} />
      </div>

      {/* Stake + game + WIN PAYS + ENTER ARENA */}
      <div style={{
        padding: 14, borderRadius: 18,
        background: "rgba(8,2,32,0.7)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(10px)",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em" }}>
            STAKE LOCKED · {tier.amount} G$
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 11px", borderRadius: 10,
            background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.35)",
          }}>
            <span style={{ color: "rgba(134,239,172,0.85)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>WIN PAYS</span>
            <span style={{ color: "#86efac", fontSize: 13, fontWeight: 900, lineHeight: 1 }}>+{payout} G$</span>
          </div>
        </div>

        {/* Game-type toggle */}
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(${GAME_TYPES.length}, 1fr)`, gap: 6,
          padding: 4, borderRadius: 12,
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          {GAME_TYPES.map(g => {
            const sel = g.id === game.id;
            return (
              <button key={g.id} onClick={() => setGame(g)} style={{
                padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                background: sel
                  ? "linear-gradient(180deg, rgba(167,139,250,0.3) 0%, rgba(99,102,241,0.3) 100%)"
                  : "transparent",
                border: sel ? "1px solid rgba(167,139,250,0.6)" : "1px solid transparent",
                color: sel ? "white" : "rgba(220,210,255,0.6)",
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

        {/* Agent offline / out-of-funds banner — blocks the challenge */}
        {!agentLiveness.online && (
          <AgentLivenessBanner reason={agentLiveness.reason} />
        )}

        {/* ENTER ARENA button — gated on agent being online */}
        <button
          onClick={busy || !agentLiveness.online ? undefined : onStart}
          disabled={busy || !agentLiveness.online}
          style={{
            padding: "16px 18px", borderRadius: 14,
            cursor: busy ? "wait" : !agentLiveness.online ? "not-allowed" : "pointer",
            border: !agentLiveness.online
              ? "1.5px solid rgba(255,255,255,0.12)"
              : `1.5px solid ${tier.rim}`,
            background: !agentLiveness.online
              ? "rgba(255,255,255,0.06)"
              : `linear-gradient(180deg, ${tier.rim}, ${tier.rim}cc)`,
            boxShadow: !agentLiveness.online
              ? "none"
              : `0 12px 26px -6px ${tier.rim}cc, inset 0 1px 0 rgba(255,255,255,0.45)`,
            color: !agentLiveness.online ? "rgba(220,210,255,0.55)" : "#04001a",
            fontWeight: 900, fontSize: 15, letterSpacing: "0.08em",
            opacity: busy ? 0.7 : !agentLiveness.online ? 0.7 : 1,
            transition: "opacity 0.12s, transform 0.1s, background 0.2s, border-color 0.2s",
          }}
          onMouseDown={e => { if (!busy && agentLiveness.online) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)"; }}
          onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ""; }}
        >
          {busy
            ? "OPENING…"
            : !agentLiveness.online
              ? "⚠ MARKOV-1 UNAVAILABLE"
              : `▶ ENTER ARENA · ${tier.amount} G$`}
        </button>

        <div style={{
          color: "rgba(220,210,255,0.4)", fontSize: 9.5, fontWeight: 700,
          letterSpacing: "0.06em", textAlign: "center",
        }}>
          🛡️ tie goes to you · 30% of every loss ({ubiSplit} G$) funds UBI
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 12,
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
          color: "#fca5a5", fontSize: 12, fontWeight: 700, textAlign: "center",
        }}>{error}</div>
      )}

      {/* RECENT FIGHTS */}
      <RecentFights matches={matches.filter(m => m.status === MATCH_STATUS.COMPLETED).slice(0, 6)} setTier={setTier} />
    </div>
  );
}

// ─── HeroPanel ──────────────────────────────────────────────────────────────
function HeroPanel({ tier, record, winrate, isDesktop }: {
  tier: WagerTier;
  record: { wins: number; losses: number; streak: number };
  winrate: number | null;
  isDesktop?: boolean;
}) {
  const wlColor = winrate === null ? "rgba(220,210,255,0.6)"
    : winrate >= 60 ? "#86efac"
    : winrate >= 40 ? "#fbbf24"
    : "#fda4af";

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 22,
      border: `1.5px solid ${tier.rim}88`,
      boxShadow: `0 24px 60px -16px ${tier.rim}77, inset 0 1px 0 rgba(255,255,255,0.08)`,
      minHeight: isDesktop ? 420 : 320,
      display: "flex", flexDirection: "column",
    }}>
      {/* Layered backdrop */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: tier.portraitBg }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/games/challenge-ai-v2/ai-arena.png" alt="" style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "cover", opacity: 0.32, mixBlendMode: "overlay",
        pointerEvents: "none",
      }} />
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, transparent 0%, transparent 45%, rgba(4,0,26,0.88) 100%)",
        pointerEvents: "none",
      }} />

      {/* Top — difficulty + record badge */}
      <div style={{
        position: "relative", zIndex: 2,
        padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 999,
            background: tier.rim, color: "#04001a",
            fontSize: 10, fontWeight: 900, letterSpacing: "0.14em",
            alignSelf: "flex-start",
          }}>{tier.difficulty} · {tier.multi}×</span>
          <span style={{
            color: "rgba(220,210,255,0.6)", fontSize: 10, fontWeight: 800, letterSpacing: "0.16em",
          }}>{tier.behavior} AI</span>
        </div>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2,
          padding: "6px 11px", borderRadius: 10,
          background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(8px)",
        }}>
          <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.18em" }}>YOUR RECORD</span>
          <span style={{ color: wlColor, fontSize: 14, fontWeight: 900, lineHeight: 1 }}>
            {record.wins}W · {record.losses}L
          </span>
          {record.streak >= 2 && (
            <span style={{ color: "#86efac", fontSize: 9, fontWeight: 800 }}>+{record.streak} streak 🔥</span>
          )}
        </div>
      </div>

      {/* Portrait */}
      <div style={{
        position: "relative", zIndex: 1, flex: 1,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "6px 20px 0", minHeight: 180,
      }}>
        <div style={{
          position: "relative",
          width: "min(80%, 240px)", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div aria-hidden style={{
            position: "absolute", inset: -10,
            background: `radial-gradient(circle, ${tier.rim}55 0%, ${tier.rim}11 40%, transparent 70%)`,
            filter: "blur(10px)",
          }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tier.art} alt={tier.persona} style={{
            position: "relative", zIndex: 1,
            maxHeight: "100%", maxWidth: "100%", objectFit: "contain",
            filter: `drop-shadow(0 18px 24px ${tier.rim}88) drop-shadow(0 4px 8px rgba(0,0,0,0.5))`,
            animation: "float-gentle 4.5s ease-in-out infinite",
            ...imgMask,
          }} />
        </div>
      </div>

      {/* Bottom — name + behaviorDesc + spec sheet */}
      <div style={{
        position: "relative", zIndex: 2,
        padding: "12px 16px 14px",
        background: "linear-gradient(180deg, transparent 0%, rgba(4,0,26,0.7) 30%, rgba(4,0,26,0.96) 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{
            color: "white", fontSize: 26, fontWeight: 900, margin: 0,
            letterSpacing: "-0.005em",
            textShadow: `0 0 18px ${tier.rim}66`,
          }}>{tier.persona}</h2>
          <span style={{
            color: tier.rimSoft, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.14em",
          }}>{tier.title.toUpperCase()}</span>
        </div>
        <p style={{
          color: "rgba(220,210,255,0.7)", fontSize: 12, margin: "6px 0 0",
          lineHeight: 1.45,
        }}>{tier.behaviorDesc}</p>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {([
            { label: "NEURAL",    v: tier.specs.neural },
            { label: "MEMORY",    v: tier.specs.memory },
            { label: "FORESIGHT", v: tier.specs.foresight },
          ] as const).map(s => (
            <div key={s.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.14em" }}>{s.label}</span>
                <span style={{ color: tier.rimSoft, fontSize: 10, fontWeight: 900, lineHeight: 1 }}>{s.v}</span>
              </div>
              <div style={{
                height: 4, borderRadius: 999, background: "rgba(0,0,0,0.6)",
                border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden",
              }}>
                <div style={{
                  width: `${Math.min(100, (s.v / 300) * 100)}%`, height: "100%",
                  background: `linear-gradient(90deg, ${tier.rim}, ${tier.rimSoft})`,
                  boxShadow: `0 0 6px ${tier.rim}`,
                  transition: "width 0.4s",
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SelectorRail ────────────────────────────────────────────────────────────
function SelectorRail({ tier, setTier, records }: {
  tier: WagerTier; setTier: (t: WagerTier) => void;
  records: Record<string, { wins: number; losses: number; streak: number }>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 800,
        letterSpacing: "0.18em", padding: "0 2px",
      }}>OPPONENTS · {WAGER_TIERS.length}</div>

      {WAGER_TIERS.map(t => {
        const isActive = t.id === tier.id;
        const rec = records[t.id] ?? { wins: 0, losses: 0, streak: 0 };
        return (
          <button key={t.id} onClick={() => setTier(t)} style={{
            position: "relative", overflow: "hidden",
            padding: "10px 12px", borderRadius: 14, cursor: "pointer", textAlign: "left",
            background: isActive
              ? `linear-gradient(135deg, ${t.rim}33, rgba(4,0,26,0.85))`
              : "rgba(8,2,32,0.55)",
            border: `1.5px solid ${isActive ? t.rim : "rgba(255,255,255,0.08)"}`,
            boxShadow: isActive
              ? `0 8px 22px -6px ${t.rim}99, inset 0 1px 0 rgba(255,255,255,0.08)`
              : "none",
            display: "flex", alignItems: "center", gap: 12,
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}>
            {/* Mini portrait */}
            <div style={{
              position: "relative", flexShrink: 0,
              width: 56, height: 56, borderRadius: 13,
              background: t.portraitBg,
              border: `1.5px solid ${t.rim}aa`,
              boxShadow: `0 0 14px ${t.rim}66, inset 0 -2px 6px rgba(0,0,0,0.3)`,
              overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.art} alt={t.persona} style={{
                width: "110%", height: "110%", objectFit: "contain",
                filter: `drop-shadow(0 2px 4px ${t.rim}aa)`,
                ...imgMask,
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ color: "white", fontSize: 15, fontWeight: 900, lineHeight: 1 }}>{t.persona}</span>
                <span style={{ color: t.rimSoft, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>{t.difficulty}</span>
              </div>
              <div style={{
                color: "rgba(220,210,255,0.65)", fontSize: 10.5, fontWeight: 700,
                marginTop: 3, lineHeight: 1.3,
              }}>
                {t.behavior} · {t.amount} G$ · {rec.wins}W·{rec.losses}L
              </div>
            </div>
            <div style={{
              flexShrink: 0,
              width: 24, height: 24, borderRadius: 999,
              background: isActive ? t.rim : "transparent",
              border: `1.5px solid ${isActive ? t.rim : "rgba(255,255,255,0.15)"}`,
              color: isActive ? "#04001a" : "rgba(220,210,255,0.45)",
              fontSize: 11, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{isActive ? "✓" : "›"}</div>
          </button>
        );
      })}
    </div>
  );
}

// ─── RecentFights ────────────────────────────────────────────────────────────
function RecentFights({ matches, setTier }: {
  matches: ArenaMatch[];
  setTier: (t: WagerTier) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        padding: "0 2px 6px",
      }}>
        <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.18em" }}>
          RECENT FIGHTS · LAST {matches.length}
        </span>
      </div>
      <div className="hide-scrollbar" style={{
        display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
        margin: "0 -14px", padding: "0 14px 4px",
      }}>
        {matches.map(m => {
          const tier = WAGER_TIERS.find(t => t.amountWei === m.wager) ?? WAGER_TIERS[1];
          const won = false; // computed by parent? Actually we don't pass address here.
          // We don't have address here; fall back to checking via challenger == winner only doesn't work.
          // Simpler: render outcome label by comparing challenger to winner is not directly possible without address.
          // We do have the match's `winner` and the active player is the one calling this page; the parent passes
          // already-filtered "your matches" so the player is always the challenger of these matches.
          // Determine win by: challenger == winner (assuming the player IS the challenger in these matches).
          const youWon = m.winner.toLowerCase() === m.challenger.toLowerCase();
          const ties = won; // unused
          void ties;
          const wager = Number(formatUnits(m.wager, 18));
          const net = youWon ? +wager * (tier.multi - 1) : -wager;
          const result: "win" | "loss" = youWon ? "win" : "loss";
          const resColor = result === "win" ? "#22c55e" : "#f43f5e";
          return (
            <button key={String(m.id)} onClick={() => setTier(tier)} style={{
              flexShrink: 0, width: 158,
              padding: 0, border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, overflow: "hidden", cursor: "pointer", textAlign: "left",
              background: "rgba(8,2,32,0.65)",
              position: "relative",
            }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
                background: resColor,
                boxShadow: `0 0 10px ${resColor}99`,
              }} />
              <div style={{ padding: "10px 12px 10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  position: "relative", flexShrink: 0,
                  width: 34, height: 34, borderRadius: 10,
                  background: tier.portraitBg,
                  border: `1px solid ${tier.rim}66`,
                  overflow: "hidden",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tier.art} alt="" style={{
                    width: "115%", height: "115%", objectFit: "contain",
                    ...imgMask,
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                    <span style={{ color: "white", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>{tier.persona}</span>
                    <span style={{ color: resColor, fontSize: 8.5, fontWeight: 900, letterSpacing: "0.1em" }}>
                      {result.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 3 }}>
                    <span style={{ color: "rgba(220,210,255,0.5)", fontSize: 9, fontWeight: 700 }}>#{String(m.id)}</span>
                    <span style={{
                      color: net > 0 ? "#86efac" : net < 0 ? "#fca5a5" : "rgba(220,210,255,0.7)",
                      fontSize: 11, fontWeight: 900,
                    }}>{net > 0 ? "+" : ""}{net.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── ArenaVS ─────────────────────────────────────────────────────────────────
// Composition rules:
//   - Tier+game info lives in a TOP chip so it never collides with the
//     center VS art (the old layout overlapped them).
//   - Player content hugs the TOP of its half, AI content hugs the BOTTOM of
//     its half — both pushed *away* from the center seam by generous inner
//     padding. The center 30% of the screen stays clear for VS/FIGHT.
//   - At phase 3 the FIGHT word REPLACES the VS art in the same center slot
//     (this is how fighting games do it; stacking them looks broken).
//   - Name ribbons (rim-colored bars flanking the text) replace plain text
//     labels so they read as nameplates instead of floating type.
function ArenaVS({ tier, game, pet }: { tier: WagerTier; game: GameType; pet: PetStage }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 700);   // AI slides in
    const t2 = setTimeout(() => setPhase(2), 1400);  // VS art appears
    const t3 = setTimeout(() => setPhase(3), 2400);  // FIGHT slams in (replaces VS art)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 5,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Stakes chip — sits high so it never overlaps the center art. */}
      <div style={{
        position: "absolute", top: 72, left: "50%",
        transform: "translateX(-50%)",
        zIndex: 8, pointerEvents: "none",
        padding: "7px 16px",
        background: "rgba(15,11,38,0.72)",
        border: "1px solid rgba(167,139,250,0.45)",
        borderRadius: 999,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        animation: "chip-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both",
        whiteSpace: "nowrap",
      }}>
        <span style={{
          color: "rgba(220,210,255,0.95)", fontSize: 10.5, fontWeight: 800,
          letterSpacing: "0.28em",
          textShadow: "0 0 8px rgba(167,139,250,0.5)",
        }}>{tier.amount} G$ · {game.shortName} · 1 ROUND</span>
      </div>

      {/* Player side (top half) */}
      <div style={{
        flex: 1, position: "relative",
        display: "flex", flexDirection: "column", justifyContent: "flex-start", alignItems: "center",
        padding: "120px 20px 90px", // top clears the chip; bottom pushes content off the seam
        background: "linear-gradient(180deg, rgba(167,139,250,0.18) 0%, transparent 70%)",
        animation: "vs-slide-in-left 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}>
        <div style={{
          position: "relative",
          width: 128, height: 128, borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, ${pet.color}99, rgba(99,102,241,0.18))`,
          border: `2.5px solid ${pet.color}`,
          boxShadow: `0 0 36px ${pet.color}77`,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pet.src} alt={pet.name} style={{
            width: "80%", height: "80%", objectFit: "contain",
            filter: `drop-shadow(0 4px 10px ${pet.color}aa)`,
          }} />
        </div>
        <NameRibbon label="CHALLENGER" rim="rgba(167,139,250,0.9)" delay="0.15s" />
        <Badge label="YOU · TIE WINS" rim="rgba(167,139,250,0.55)" delay="0.3s" />
      </div>

      {/* Diagonal seam — adds energy vs a flat horizontal line. */}
      <div aria-hidden style={{
        position: "absolute", top: "50%", left: "-10%", right: "-10%", height: 2,
        background: "linear-gradient(90deg, transparent, rgba(167,139,250,0.55) 22%, rgba(255,255,255,0.8) 50%, rgba(56,189,248,0.55) 78%, transparent)",
        boxShadow: "0 0 18px rgba(255,255,255,0.35)",
        transform: "translateY(-1px) rotate(-2.5deg)",
        zIndex: 4,
      }} />

      {/* Center art slot — burst + VS art, swapped for FIGHT at phase 3. */}
      {phase >= 2 && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)", zIndex: 6,
          pointerEvents: "none",
          width: 280, height: 280,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/games/challenge-ai-v2/ai-burst.png" alt="" style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 480, height: 480, objectFit: "contain",
            opacity: phase >= 3 ? 0.42 : 0.55,
            mixBlendMode: "screen",
            animation: "vs-burst 1s ease-out both",
            transition: "opacity 0.25s ease-out",
          }} />

          {phase < 3 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/games/challenge-ai-v2/ai-vs.png" alt="VS" style={{
              width: 220, height: 220, objectFit: "contain",
              filter: "drop-shadow(0 0 36px rgba(56,189,248,0.85)) drop-shadow(0 0 12px rgba(56,189,248,0.6))",
              // screen blend knocks out any subtle grey halo in the PNG.
              mixBlendMode: "screen",
              animation: "vs-zoom 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
              position: "relative", zIndex: 2,
            }} />
          )}

          {phase >= 3 && (
            <div style={{
              position: "relative", zIndex: 2,
              color: "white",
              fontSize: 76, fontWeight: 900,
              letterSpacing: "0.04em",
              fontStyle: "italic",
              textShadow:
                "0 0 32px rgba(167,139,250,0.9)," +
                "0 0 16px rgba(56,189,248,0.7)," +
                "0 3px 0 rgba(0,0,0,0.55)," +
                "0 0 4px rgba(0,0,0,0.9)",
              animation: "fight-slam 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
            }}>FIGHT!</div>
          )}
        </div>
      )}

      {/* AI side (bottom half) */}
      <div style={{
        flex: 1, position: "relative",
        display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
        padding: "90px 20px 56px", // top pushes content off the seam
        opacity: phase >= 1 ? 1 : 0,
        background: `linear-gradient(0deg, ${tier.rim}26 0%, transparent 70%)`,
        animation: phase >= 1 ? "vs-slide-in-right 0.7s cubic-bezier(0.16, 1, 0.3, 1) both" : "none",
      }}>
        <Badge label={`${tier.difficulty.toUpperCase()} · ${tier.behavior.toUpperCase()}`} rim={`${tier.rim}99`} delay="0.85s" />
        <NameRibbon label={tier.persona.toUpperCase()} rim={tier.rim} delay="0.7s" />
        <div style={{
          position: "relative",
          width: 152, height: 152, marginTop: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div aria-hidden style={{
            position: "absolute", inset: -8,
            background: `radial-gradient(circle, ${tier.rim}66 0%, transparent 65%)`,
            filter: "blur(10px)",
          }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tier.art} alt={tier.persona} style={{
            position: "relative", zIndex: 1,
            width: "100%", height: "100%", objectFit: "contain",
            filter: `drop-shadow(0 8px 18px ${tier.rim}cc) drop-shadow(0 0 14px ${tier.rim}88)`,
            ...imgMask,
          }} />
        </div>
      </div>
    </div>
  );
}

// Name ribbon: rim-colored bars flank the name so it reads as a nameplate,
// not floating text. Mirrors the title-card pattern from fighting games.
function NameRibbon({ label, rim, delay }: { label: string; rim: string; delay: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      marginTop: 12,
      animation: `ribbon-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) ${delay} both`,
      maxWidth: "92vw",
    }}>
      <span aria-hidden style={{
        flex: "0 0 28px", height: 2,
        background: `linear-gradient(90deg, transparent, ${rim})`,
        boxShadow: `0 0 8px ${rim}`,
      }} />
      <span style={{
        color: "white", fontSize: 22, fontWeight: 900,
        letterSpacing: "0.06em",
        textShadow: `0 0 14px ${rim}, 0 1px 2px rgba(0,0,0,0.7)`,
        whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>{label}</span>
      <span aria-hidden style={{
        flex: "0 0 28px", height: 2,
        background: `linear-gradient(270deg, transparent, ${rim})`,
        boxShadow: `0 0 8px ${rim}`,
      }} />
    </div>
  );
}

function Badge({ label, rim, delay }: { label: string; rim: string; delay: string }) {
  return (
    <div style={{
      marginTop: 8,
      padding: "5px 11px",
      background: "rgba(8,6,22,0.55)",
      border: `1px solid ${rim}`,
      borderRadius: 999,
      color: "rgba(235,230,255,0.92)",
      fontSize: 9.5, fontWeight: 800,
      letterSpacing: "0.22em",
      textShadow: "0 0 6px rgba(0,0,0,0.85)",
      animation: `chip-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${delay} both`,
      whiteSpace: "nowrap",
    }}>{label}</div>
  );
}

// ─── ArenaMatch ──────────────────────────────────────────────────────────────
function ArenaMatch({ tier, game, pet, activeMatch, playerHasPlayed, aiHasPlayed, playerMove, aiMove, holdingReveal, tierHistory, onPick, submitting, youWon, error, proposedStale, lockStale, onLobby }: {
  tier: WagerTier; game: GameType; pet: PetStage;
  activeMatch: ArenaMatch | null;
  playerHasPlayed: boolean; aiHasPlayed: boolean;
  playerMove: number | null; aiMove: number | null;
  holdingReveal: boolean;
  tierHistory: { player: number[]; ai: number[] };
  onPick: (m: number) => void;
  submitting: boolean;
  youWon: boolean;
  error: string | null;
  proposedStale: boolean;
  lockStale: boolean;
  onLobby: () => void;
}) {
  // Drive the right inner state from the chain.
  const proposed   = activeMatch?.status === MATCH_STATUS.PROPOSED;
  const accepted   = activeMatch?.status === MATCH_STATUS.ACCEPTED;
  const completed  = activeMatch?.status === MATCH_STATUS.COMPLETED;
  const revealing  = completed && holdingReveal;
  const showPickButtons = accepted && !playerHasPlayed;
  const locked     = accepted && playerHasPlayed;
  const aiThinking = (proposed || (accepted && playerHasPlayed && !aiHasPlayed));

  // Animated AI taunt — rotates from the tier's taunt pool while waiting.
  const [taunt, setTaunt] = useState<string>(tier.lines.ready);
  useEffect(() => {
    if (revealing || completed) return;
    if (proposed) { setTaunt("Matching your wager…"); return; }
    if (accepted && !playerHasPlayed) {
      setTaunt(tier.lines.ready);
      const i = setInterval(() => {
        const p = tier.lines.taunt;
        if (p.length > 0) setTaunt(p[Math.floor(Math.random() * p.length)]);
      }, 3500);
      return () => clearInterval(i);
    }
    if (locked) setTaunt("Computing the counter…");
  }, [proposed, accepted, playerHasPlayed, locked, completed, revealing, tier.lines.ready, tier.lines.taunt]);

  const [showHint, setShowHint] = useState(false);
  const roundOutcome: "win" | "lose" | "tie" | null = revealing && playerMove !== null && aiMove !== null
    ? (playerMove === aiMove ? "tie" : youWon ? "win" : "lose")
    : null;

  // Live AI hand cycling — Rael's feedback: the AI feels invisible during
  // LOCK because the hand stays as "?". This cycles the AI's pick slot
  // through the available moves at ~180ms so the player feels the AI is
  // actively choosing in real-time. When the chain confirms and we enter
  // REVEAL, the real move replaces the cycling emoji with a satisfying
  // lock-in pop.
  const [aiCycleIdx, setAiCycleIdx] = useState(0);
  useEffect(() => {
    if (!locked || revealing || completed) return;
    const moveCount = game.moves.length;
    const i = setInterval(() => setAiCycleIdx(x => (x + 1) % moveCount), 180);
    return () => clearInterval(i);
  }, [locked, revealing, completed, game.moves.length]);
  const aiCyclingMove = locked && !revealing ? aiCycleIdx % game.moves.length : null;

  // Oracle coin flip — coin-game only. We derive the oracle's landing
  // side from the chain result so the visible coin matches what actually
  // determined the outcome:
  //   - Different picks → the winner's call matched the oracle.
  //   - Same picks + you won → both were wrong (consolation tie rule).
  //                            Oracle landed on the OPPOSITE side from
  //                            your shared call.
  //   - Same picks + AI won → both were right (house-edge tie rule).
  //                            Oracle landed on your shared call.
  const oracleSide: number | null = useMemo(() => {
    if (game.id !== GAME_TYPE_COIN) return null;
    if (playerMove === null || aiMove === null) return null;
    if (playerMove === aiMove) {
      return youWon ? (1 - playerMove) : playerMove;
    }
    return youWon ? playerMove : aiMove;
  }, [game.id, playerMove, aiMove, youWon]);

  const [oracleSpinIdx, setOracleSpinIdx] = useState(0);
  const [oracleLanded, setOracleLanded] = useState(false);
  useEffect(() => {
    if (!revealing || oracleSide === null) {
      setOracleLanded(false);
      return;
    }
    setOracleLanded(false);
    // Fast alternation (90ms) reads as a true coin flip.
    const spin = setInterval(() => setOracleSpinIdx(x => (x + 1) % 2), 90);
    // Land at 650ms into the reveal hold — leaves room for the outcome
    // text to play in the remaining hold time.
    const land = setTimeout(() => { clearInterval(spin); setOracleLanded(true); }, 650);
    return () => { clearInterval(spin); clearTimeout(land); };
  }, [revealing, oracleSide]);
  const oracleDisplay = oracleLanded ? oracleSide : oracleSpinIdx % 2;

  return (
    <div style={{
      maxWidth: 540, margin: "0 auto",
      padding: "60px 14px 18px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* AI HUD */}
      <CombatantHUD side="ai" tier={tier} stake={activeMatch?.wager} />

      {/* Agent-offline warning — honest UX when MARKOV isn't responding */}
      {(proposedStale || lockStale) && (
        <AgentOfflineWarning kind={proposedStale ? "accept" : "play"} matchId={activeMatch?.id ?? null} onLobby={onLobby} />
      )}

      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "stretch", gap: 8,
      }}>
        {/* AI combatant row */}
        <CombatantStage
          side="ai" tier={tier} gameId={game.id}
          pick={revealing || (completed && !revealing) ? aiMove : null}
          cyclingMove={aiCyclingMove}
          revealing={!!revealing} outcome={roundOutcome}
          taunt={!revealing ? taunt : null}
          isThinking={aiThinking}
        />

        {/* Center reveal area — taller on coin flip so the visible oracle
            coin has room to spin and land. */}
        <div style={{
          position: "relative",
          height: revealing && game.id === GAME_TYPE_COIN ? 110 : 62,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "height 0.25s",
        }}>
          {revealing && game.id === GAME_TYPE_COIN ? (
            // Coin flip reveal — the oracle is the third hand. Spinning
            // emoji for ~650ms, then lands on the side that matched the
            // winner's call. Outcome text appears with the landing.
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              animation: "reveal-text 0.4s ease-out both",
              position: "relative", zIndex: 2,
            }}>
              <div style={{
                color: oracleLanded
                  ? (roundOutcome === "win" ? "#86efac" : roundOutcome === "lose" ? "#fda4af" : "#fde68a")
                  : "rgba(220,210,255,0.6)",
                fontSize: 9.5, fontWeight: 900, letterSpacing: "0.24em",
                textShadow: oracleLanded
                  ? `0 0 12px ${roundOutcome === "win" ? "#22c55e" : roundOutcome === "lose" ? "#f43f5e" : "#fbbf24"}`
                  : "none",
                transition: "color 0.2s, text-shadow 0.2s",
              }}>
                {oracleLanded ? "THE COIN LANDED" : "FLIPPING…"}
              </div>
              <div style={{
                fontSize: 56,
                filter: `drop-shadow(0 6px 14px rgba(0,0,0,0.55))`,
                animation: oracleLanded
                  ? "coin-spin 0.6s cubic-bezier(0.16, 1, 0.3, 1)"
                  : undefined,
              }}>
                {oracleDisplay === 0 ? "🪙" : "🦅"}
              </div>
              {oracleLanded && (
                <div style={{
                  color: roundOutcome === "win" ? "#22c55e" : roundOutcome === "lose" ? "#f43f5e" : "#fbbf24",
                  fontSize: 22, fontWeight: 900, letterSpacing: "0.06em",
                  textShadow: `0 0 18px ${roundOutcome === "win" ? "#22c55e" : roundOutcome === "lose" ? "#f43f5e" : "#fbbf24"}`,
                  animation: "reveal-text 0.45s ease-out both",
                  marginTop: 2,
                }}>{roundOutcome === "win" ? "YOU WIN" : roundOutcome === "lose" ? "MARKOV WINS" : "TIE — YOURS"}</div>
              )}
            </div>
          ) : revealing && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/games/challenge-ai-v2/ai-glitch.png" alt="" style={{
                position: "absolute", width: 280, height: 280, objectFit: "contain",
                opacity: 0.6, mixBlendMode: "screen",
                animation: "reveal-burst 0.8s ease-out both",
                pointerEvents: "none",
              }} />
              <div style={{
                color: roundOutcome === "win" ? "#22c55e" : roundOutcome === "lose" ? "#f43f5e" : "#fbbf24",
                fontSize: 30, fontWeight: 900, letterSpacing: "0.06em",
                textShadow: `0 0 28px ${roundOutcome === "win" ? "#22c55e" : roundOutcome === "lose" ? "#f43f5e" : "#fbbf24"}`,
                animation: "reveal-text 0.6s ease-out both",
                position: "relative", zIndex: 2,
              }}>{roundOutcome === "win" ? "YOU WIN" : roundOutcome === "lose" ? "MARKOV WINS" : "TIE — YOURS"}</div>
            </>
          )}
          {!revealing && (
            <div style={{
              color: "rgba(220,210,255,0.55)", fontSize: 9.5, fontWeight: 800, letterSpacing: "0.24em",
            }}>
              {proposed
                ? "MARKOV LOCKING IN…"
                : locked
                ? "REVEAL INCOMING"
                : completed
                ? "PREPARING NEXT MATCH…"
                : accepted
                ? "MAKE YOUR MOVE"
                : "WAITING FOR MATCH…"}
            </div>
          )}
        </div>

        {/* Player combatant row */}
        <CombatantStage
          side="player" tier={tier} gameId={game.id}
          pick={playerMove !== null ? playerMove : null}
          revealing={!!revealing} outcome={roundOutcome}
          pet={pet}
        />
      </div>

      {/* Player HUD */}
      <CombatantHUD side="player" tier={tier} stake={activeMatch?.wager} />

      {/* Tactical hint */}
      {tierHistory.player.length + tierHistory.ai.length > 0 && (
        <>
          <button onClick={() => setShowHint(s => !s)} style={{
            marginTop: 4, padding: "6px 11px", borderRadius: 999, cursor: "pointer",
            background: showHint ? `${tier.rim}22` : "rgba(255,255,255,0.04)",
            border: `1px solid ${showHint ? `${tier.rim}88` : "rgba(255,255,255,0.08)"}`,
            color: showHint ? tier.rim : "rgba(220,210,255,0.55)",
            fontSize: 9.5, fontWeight: 800, letterSpacing: "0.16em",
            alignSelf: "flex-start",
          }}>🎯 TACTICAL HINT{showHint ? " · ON" : ""}</button>
          {showHint && (
            <div style={{
              marginTop: 4, padding: "8px 12px", borderRadius: 12,
              background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(8px)",
              display: "flex", justifyContent: "space-between", gap: 14,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "rgba(220,210,255,0.55)", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em", marginBottom: 4 }}>
                  YOUR LAST 3
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {tierHistory.player.length === 0
                    ? <span style={{ color: "rgba(220,210,255,0.4)", fontSize: 10, fontStyle: "italic" }}>—</span>
                    : tierHistory.player.map((m, i) => (
                      <span key={i} style={{ fontSize: 18 }}>{moveDisplay(game.id, m).emoji}</span>
                    ))}
                </div>
              </div>
              <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: tier.rimSoft, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em", marginBottom: 4 }}>
                  {tier.persona.toUpperCase()} LAST 3
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {tierHistory.ai.length === 0
                    ? <span style={{ color: "rgba(220,210,255,0.4)", fontSize: 10, fontStyle: "italic" }}>—</span>
                    : tierHistory.ai.map((m, i) => (
                      <span key={i} style={{ fontSize: 18 }}>{moveDisplay(game.id, m).emoji}</span>
                    ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Rules hint — surfaced above move buttons during PICK so the player
          understands what determines the outcome before they wager their
          move. Pulled from lib so RPS / Coin / future game types stay in
          sync with their canonical rules text. */}
      {showPickButtons && (
        <div style={{
          marginTop: 10,
          padding: "9px 12px",
          borderRadius: 12,
          background: "rgba(167,139,250,0.08)",
          border: "1px solid rgba(167,139,250,0.25)",
          color: "rgba(220,210,255,0.85)",
          fontSize: 11, lineHeight: 1.4, fontWeight: 600,
          display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>💡</span>
          <span>{game.rules}</span>
        </div>
      )}

      {/* Move buttons */}
      {showPickButtons && (
        <div style={{
          display: "grid", gridTemplateColumns: `repeat(${game.moves.length}, 1fr)`,
          gap: 10, marginTop: 10,
        }}>
          {game.moves.map(m => (
            <button key={m.id} onClick={() => onPick(m.id)} disabled={submitting} style={{
              padding: "16px 0 12px", borderRadius: 18, cursor: submitting ? "wait" : "pointer",
              background: "rgba(255,255,255,0.04)",
              border: `1.5px solid rgba(255,255,255,0.1)`,
              opacity: submitting ? 0.6 : 1,
              transition: "all 0.15s",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
              color: "white",
            }}
              onMouseEnter={e => {
                if (submitting) return;
                (e.currentTarget as HTMLButtonElement).style.background = `${tier.rim}1f`;
                (e.currentTarget as HTMLButtonElement).style.borderColor = `${tier.rim}99`;
                (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 24px ${tier.rim}44`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
              }}
            >
              <span style={{ fontSize: 32 }}>{m.emoji}</span>
              <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.14em", color: "rgba(220,210,255,0.7)" }}>
                {m.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 8, padding: "10px 14px", borderRadius: 12,
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
          color: "#fca5a5", fontSize: 11, fontWeight: 700, textAlign: "center",
        }}>{error}</div>
      )}
    </div>
  );
}

function CombatantHUD({ side, tier, stake }: { side: "player" | "ai"; tier: WagerTier; stake: bigint | undefined }) {
  const isPlayer = side === "player";
  const name = isPlayer ? "CHALLENGER" : tier.persona.toUpperCase();
  const accent = isPlayer ? "#a78bfa" : tier.rim;
  const sub = isPlayer ? "YOU · TIE WINS" : `${tier.difficulty} · ${tier.behavior}`;
  const wager = stake ? Number(formatUnits(stake, 18)).toFixed(2) : "—";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 12px", borderRadius: 12,
      background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        color: accent, fontSize: 13, fontWeight: 900, letterSpacing: "0.02em",
        textShadow: `0 0 8px ${accent}66`,
      }}>{name}</div>
      <div style={{
        color: "rgba(220,210,255,0.55)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em",
      }}>{sub}</div>
      <div style={{ flex: 1 }} />
      <div style={{
        color: "white", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
      }}>{wager} G$</div>
    </div>
  );
}

function CombatantStage({ side, tier, gameId, pick, cyclingMove, revealing, outcome, taunt, isThinking, pet }: {
  side: "player" | "ai"; tier: WagerTier;
  gameId: 0 | 3;
  pick: number | null;
  // Live-cycling move index for the AI during LOCK — animates the pick
  // slot through the available moves so the AI feels like it's actively
  // choosing instead of sitting on a static "?".
  cyclingMove?: number | null;
  revealing: boolean;
  outcome: "win" | "lose" | "tie" | null;
  taunt?: string | null;
  isThinking?: boolean;
  pet?: PetStage;
}) {
  const isPlayer = side === "player";
  const playerAccent = pet?.color ?? "#a78bfa";
  const accent = isPlayer ? playerAccent : tier.rim;
  const winSide = outcome === (isPlayer ? "win" : "lose");
  const loseSide = outcome === (isPlayer ? "lose" : "win");
  return (
    <div style={{
      display: "flex", flexDirection: isPlayer ? "row" : "row-reverse",
      alignItems: "center", gap: 12, width: "100%",
    }}>
      {/* Portrait */}
      <div style={{
        position: "relative", flexShrink: 0,
        width: 92, height: 92, borderRadius: "50%",
        background: isPlayer
          ? `radial-gradient(circle at 35% 30%, ${playerAccent}99, rgba(99,102,241,0.18))`
          : tier.portraitBg,
        border: `2.5px solid ${accent}`,
        boxShadow: `0 0 22px ${accent}66, inset 0 -2px 8px rgba(0,0,0,0.4)`,
        overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: winSide ? "combatant-cheer 0.55s ease-out" : loseSide ? "combatant-hit 0.55s ease-out" : "none",
      }}>
        {isPlayer && pet ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pet.src} alt={pet.name} style={{
            width: "80%", height: "80%", objectFit: "contain",
            filter: `drop-shadow(0 3px 8px ${pet.color}aa)`,
          }} />
        ) : isPlayer ? (
          <span style={{ fontSize: 54 }}>🧑</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tier.art} alt={tier.persona} style={{
            width: "115%", height: "115%", objectFit: "contain",
            ...imgMask,
          }} />
        )}
        {isThinking && !isPlayer && (
          <div aria-hidden style={{
            position: "absolute", inset: -5, borderRadius: "50%",
            border: `2px dashed ${accent}aa`,
            animation: "thinking-spin 3.2s linear infinite",
            pointerEvents: "none",
          }} />
        )}
      </div>

      {/* Pick slot — three states:
            1. revealed/locked-in: real emoji, lit border, pop animation
            2. cycling (AI mid-LOCK): live-cycling emoji at ~180ms, glowing
               border, subtle pulse — the player FEELS the AI deciding
            3. idle: "?" placeholder */}
      {(() => {
        const hasRealMove = pick !== null && (isPlayer || revealing);
        const hasCyclingMove = !hasRealMove && cyclingMove !== null && cyclingMove !== undefined;
        return (
          <div style={{
            width: 92, height: 92, borderRadius: 18,
            background: hasRealMove || hasCyclingMove
              ? `linear-gradient(180deg, ${accent}33, rgba(0,0,0,0.55))`
              : "rgba(255,255,255,0.03)",
            border: `1.5px solid ${hasRealMove ? `${accent}aa` : hasCyclingMove ? `${accent}88` : "rgba(255,255,255,0.1)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: hasRealMove
              ? `0 0 28px ${accent}55`
              : hasCyclingMove ? `0 0 18px ${accent}33` : "none",
            animation: hasRealMove && revealing
              ? "pick-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
              : hasCyclingMove ? "pulse-soft 0.4s ease-in-out infinite" : "none",
            flexShrink: 0,
            transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s",
          }}>
            {hasRealMove ? (
              <span style={{ fontSize: 46, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.5))" }}>
                {moveDisplay(gameId, pick).emoji}
              </span>
            ) : hasCyclingMove ? (
              // Lower opacity + scale so the cycling read distinct from
              // the locked-in pop: this is the AI deliberating, not the
              // final choice yet.
              <span style={{
                fontSize: 42,
                opacity: 0.72,
                filter: `drop-shadow(0 0 8px ${accent}aa)`,
                transition: "transform 0.08s",
              }}>
                {moveDisplay(gameId, cyclingMove as number).emoji}
              </span>
            ) : (
              <span style={{ color: "rgba(220,210,255,0.4)", fontSize: 34, fontWeight: 900 }}>?</span>
            )}
          </div>
        );
      })()}

      {/* Speech bubble (AI only) */}
      {!isPlayer && taunt && !revealing && (
        <div key={taunt} style={{
          flex: 1, maxWidth: 200,
          padding: "9px 12px", borderRadius: 14,
          background: "rgba(0,0,0,0.65)", border: `1px solid ${accent}55`,
          color: "white", fontSize: 11.5, lineHeight: 1.35,
          backdropFilter: "blur(6px)",
          animation: "bubble-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}>{taunt}</div>
      )}
      {isPlayer && <div style={{ flex: 1 }} />}
    </div>
  );
}

// ─── ArenaResult ────────────────────────────────────────────────────────────
function ArenaResult({ tier, game, pet, wager, youWon, tieByRule, playerMove, aiMove, record, onAgain, onLobby, busy }: {
  tier: WagerTier; game: GameType; pet: PetStage;
  wager: bigint;
  youWon: boolean; tieByRule: boolean;
  playerMove: number | null; aiMove: number | null;
  record: { wins: number; losses: number; streak: number };
  onAgain: () => void; onLobby: () => void;
  busy: boolean;
}) {
  const wagerN  = Number(formatUnits(wager, 18));
  const prizeN  = wagerN * tier.multi;
  const netN    = youWon ? (prizeN - wagerN) : tieByRule ? 0 : -wagerN;

  // Tick the payout number up.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!youWon) { setShown(netN); return; }
    let raf = 0; const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(netN * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [youWon, netN]);

  // Updated record numbers
  const newWins   = record.wins + (youWon ? 1 : 0);
  const newLosses = record.losses + (!youWon && !tieByRule ? 1 : 0);
  const newStreak = youWon ? (record.streak >= 0 ? record.streak + 1 : 1) : (!tieByRule ? 0 : record.streak);

  const headline = youWon ? "VICTORY" : tieByRule ? "STALEMATE" : "DEFEATED";
  const headlineColor = youWon ? "#86efac" : tieByRule ? "#fde68a" : "#fda4af";
  const headlineGlow  = youWon ? "rgba(34,197,94,0.55)" : tieByRule ? "rgba(251,191,36,0.55)" : "rgba(244,63,94,0.55)";

  const aiLine = youWon ? tier.lines.matchLose : tieByRule ? tier.lines.tie : tier.lines.matchWin;
  const subtext = youWon
    ? `You bested ${tier.persona} for ${tier.multi}× return on your ${wagerN.toFixed(2)} G$ stake.`
    : tieByRule
    ? "Equal move. Player-first rule applied. Your stake is returned."
    : `${tier.persona} read your pattern. 30% of your stake funds UBI.`;

  const playerEmoji = playerMove !== null ? moveDisplay(game.id, playerMove).emoji : "?";
  const aiEmoji     = aiMove     !== null ? moveDisplay(game.id, aiMove).emoji     : "?";

  return (
    <div style={{
      maxWidth: 540, margin: "0 auto",
      padding: "60px 16px 18px",
      display: "flex", flexDirection: "column",
      animation: "fadeIn 0.3s ease both",
    }}>
      {/* Aurora */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: `radial-gradient(60% 50% at 50% 25%, ${headlineGlow.replace("0.55", "0.32")} 0%, transparent 60%)`,
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
      }}>
        {/* Hero coin or persona */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {youWon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/games/challenge-ai-v2/ai-burst.png" alt="" style={{
              position: "absolute", inset: -30,
              width: "calc(100% + 60px)", height: "calc(100% + 60px)",
              objectFit: "contain", opacity: 0.7, mixBlendMode: "screen",
              animation: "result-rays 4s linear infinite", pointerEvents: "none",
            }} />
          )}
          {youWon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/games/challenge-ai-v2/ai-coin.png" alt="" style={{
              width: 156, height: 156, borderRadius: "50%",
              objectFit: "cover",
              boxShadow: "0 0 44px rgba(251,191,36,0.7), 0 16px 30px rgba(0,0,0,0.5)",
              animation: "coin-spin 0.65s cubic-bezier(0.16, 1, 0.3, 1), float-gentle 3.5s ease-in-out infinite 0.65s",
              border: "3px solid rgba(255,255,255,0.45)",
              position: "relative", zIndex: 2,
            }} />
          ) : tieByRule ? (
            <div style={{
              position: "relative",
              width: 152, height: 152, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, rgba(251,191,36,0.55), rgba(180,83,9,0.2))",
              border: "3px solid #fbbf24",
              boxShadow: "0 0 36px rgba(251,191,36,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
              animation: "popIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pet.src} alt={pet.name} style={{
                width: "75%", height: "75%", objectFit: "contain",
                filter: "drop-shadow(0 6px 14px rgba(251,191,36,0.6))",
              }} />
              <span style={{ position: "absolute", bottom: -2, right: -2, fontSize: 36 }}>🤝</span>
            </div>
          ) : (
            <div style={{
              position: "relative",
              width: 180, height: 180,
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: "popIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}>
              <div aria-hidden style={{
                position: "absolute", inset: -14,
                background: `radial-gradient(circle, ${tier.rim}55 0%, transparent 65%)`,
                filter: "blur(12px)",
              }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tier.art} alt={tier.persona} style={{
                position: "relative", zIndex: 1,
                width: "100%", height: "100%", objectFit: "contain",
                filter: `drop-shadow(0 12px 22px ${tier.rim}cc) grayscale(0.25) brightness(0.85)`,
                ...imgMask,
              }} />
            </div>
          )}
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ color: "rgba(220,210,255,0.55)", fontSize: 11, fontWeight: 900, letterSpacing: "0.24em" }}>
            {headline}
          </div>
          <div style={{
            color: headlineColor, fontSize: 42, fontWeight: 900, lineHeight: 1, marginTop: 8,
            textShadow: `0 0 28px ${headlineGlow}`,
          }}>
            {tieByRule ? "Stake returned" : `${shown >= 0 ? "+" : ""}${shown.toFixed(2)} G$`}
          </div>
          <div style={{
            color: "rgba(220,210,255,0.65)", fontSize: 12, marginTop: 10,
            maxWidth: 320, marginLeft: "auto", marginRight: "auto", lineHeight: 1.45,
          }}>{subtext}</div>
          <div style={{
            color: tier.rim, fontSize: 12, fontStyle: "italic", marginTop: 10,
          }}>“{aiLine}”</div>
        </div>

        {/* Single-round move strip */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16,
          padding: "10px 18px", borderRadius: 14,
          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(8px)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ color: "rgba(220,210,255,0.55)", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em" }}>YOU</span>
            <span style={{ fontSize: 28 }}>{playerEmoji}</span>
          </div>
          <div style={{
            color: youWon ? "#86efac" : tieByRule ? "#fde68a" : "#fda4af",
            fontSize: 13, fontWeight: 900, letterSpacing: "0.14em",
          }}>{youWon ? "W" : tieByRule ? "T" : "L"}</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ color: tier.rimSoft, fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em" }}>{tier.persona.toUpperCase()}</span>
            <span style={{ fontSize: 28 }}>{aiEmoji}</span>
          </div>
        </div>

        {/* Updated record */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
          padding: "12px 14px", borderRadius: 14,
          background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(8px)",
          width: "100%", maxWidth: 360,
        }}>
          <RecordStat label={`VS ${tier.persona.toUpperCase()}`} value={`${newWins}W · ${newLosses}L`} color="white" />
          <RecordStat label="STREAK" value={newStreak > 0 ? `+${newStreak}` : `${newStreak}`} color={newStreak > 0 ? "#86efac" : newStreak < 0 ? "#fda4af" : "white"} />
          <RecordStat label="NET" value={`${netN >= 0 ? "+" : ""}${netN.toFixed(2)}`} color={netN > 0 ? "#86efac" : netN < 0 ? "#fda4af" : "white"} />
        </div>

        {/* CTAs */}
        <div style={{ width: "100%", maxWidth: 360, marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={busy ? undefined : onAgain} disabled={busy} style={{
            padding: "14px", borderRadius: 14, cursor: busy ? "wait" : "pointer",
            background: `linear-gradient(180deg, ${tier.rim}, ${tier.rim}cc)`,
            border: `1.5px solid ${tier.rim}`,
            boxShadow: `0 12px 24px -6px ${tier.rim}aa, inset 0 1px 0 rgba(255,255,255,0.4)`,
            color: "#04001a", fontSize: 14, fontWeight: 900, letterSpacing: "0.04em",
            opacity: busy ? 0.7 : 1,
          }}>
            {busy
              ? "OPENING…"
              : youWon ? `REMATCH · WIN ${prizeN.toFixed(2)} G$ AGAIN`
              : tieByRule ? "REMATCH"
              : `AVENGE · RISK ${wagerN.toFixed(2)} G$`}
          </button>
          <button onClick={onLobby} style={{
            padding: "12px", borderRadius: 12, cursor: "pointer",
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(220,210,255,0.85)", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em",
          }}>‹ Pick a different AI</button>
        </div>
      </div>
    </div>
  );
}

function RecordStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ color: "rgba(220,210,255,0.55)", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.16em" }}>{label}</div>
      <div style={{ color, fontSize: 16, fontWeight: 900, marginTop: 3, letterSpacing: "0.01em" }}>{value}</div>
    </div>
  );
}

// ─── Top-bar chips ───────────────────────────────────────────────────────────
function StreakChip({ streak }: { streak: number }) {
  return (
    <div style={{
      padding: "5px 11px", borderRadius: 999,
      background: "rgba(251,191,36,0.16)", border: "1px solid rgba(251,191,36,0.5)",
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
      background: "rgba(134,239,172,0.12)", border: "1px solid rgba(134,239,172,0.4)",
      display: "flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ color: "rgba(134,239,172,0.8)", fontSize: 9, fontWeight: 800, letterSpacing: "0.14em" }}>G$</span>
      <span style={{ color: "#86efac", fontSize: 12, fontWeight: 900, fontFamily: "monospace" }}>{balance}</span>
    </div>
  );
}

// ─── AgentLivenessBanner ────────────────────────────────────────────────────
// Pre-challenge warning. Sits above a disabled ENTER ARENA button when the
// agent is offline / out of funds, so the player never wagers into a match
// that won't be accepted.
function AgentLivenessBanner({ reason }: { reason: "offline" | "out-of-funds" | "online" | "unknown" }) {
  const headline =
    reason === "out-of-funds" ? "MARKOV-1 is out of funds."
    : reason === "offline"    ? "MARKOV-1 is offline right now."
    :                           "MARKOV-1 is not responding.";
  const sub =
    reason === "out-of-funds"
      ? "The agent wallet can't match a wager. The operator has been notified — check back in a few minutes."
      : "The agent process isn't accepting matches. Check back in a few minutes — no stake gets locked while it's down.";
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 12,
      background: "rgba(251,191,36,0.10)",
      border: "1px solid rgba(251,191,36,0.45)",
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span style={{
          color: "#fde68a", fontSize: 12, fontWeight: 900, letterSpacing: "0.04em",
        }}>{headline}</span>
      </div>
      <div style={{
        color: "rgba(254,243,199,0.7)", fontSize: 10.5, fontWeight: 600, lineHeight: 1.4,
      }}>{sub}</div>
    </div>
  );
}

// ─── AgentOfflineWarning ────────────────────────────────────────────────────
// Honest UX when MARKOV-1's off-chain agent isn't running. The on-chain match
// is still open and will resume automatically when the agent comes back; the
// player just shouldn't be staring at an infinite spinner in the meantime.
function AgentOfflineWarning({ kind, matchId, onLobby }: {
  kind: "accept" | "play";
  matchId: bigint | null;
  onLobby: () => void;
}) {
  const text = kind === "accept"
    ? "MARKOV-1's agent is taking longer than usual to accept this match."
    : "MARKOV-1 hasn't submitted its move yet. The agent may be offline.";
  const sub = "Your stake is safe on-chain. The match resumes automatically when the agent is back online.";
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 12,
      background: "rgba(251,191,36,0.10)",
      border: "1px solid rgba(251,191,36,0.45)",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>⚠️</span>
        <span style={{ color: "#fde68a", fontSize: 11.5, fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.3 }}>
          {text}
        </span>
      </div>
      <div style={{
        color: "rgba(254,243,199,0.7)", fontSize: 10.5, fontWeight: 600, lineHeight: 1.4,
      }}>{sub}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {matchId !== null && (
          <span style={{
            color: "rgba(254,243,199,0.45)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
          }}>MATCH #{String(matchId)}</span>
        )}
        <button onClick={onLobby} style={{
          padding: "5px 11px", borderRadius: 999,
          background: "rgba(251,191,36,0.22)", border: "1px solid rgba(251,191,36,0.55)",
          color: "#fde68a", fontSize: 10, fontWeight: 900, letterSpacing: "0.12em",
          cursor: "pointer",
        }}>← BACK TO LOBBY</button>
      </div>
    </div>
  );
}
