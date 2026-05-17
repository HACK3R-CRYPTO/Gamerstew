"use client";

// ─── /games/challenge-ai (hub) ────────────────────────────────────────────────
// Arena-style hub for the Challenge AI game mode.
//
// Design goals (vs the previous flat-list layout):
//   1. MARKOV-1 owns the screen — big portrait that swaps personas when the
//      player changes wager tier. The opponent should feel like a presence.
//   2. Stats bars animate when tier changes so the selection has weight.
//   3. Rotating taunt makes the page feel alive without needing audio yet.
//   4. Compact tier + game picker — one decision row, not two scattered ones.
//   5. Hero challenge button labels the exact intent (game + wager + opponent).
//   6. "Last 5 battles" strip tells stories at a glance via move emojis.
//   7. Top bar shows G$ balance + win streak so stakes are always visible.
//   8. Ambient particle drift + radial glow per tier — page reads as a stage,
//      not a settings screen.
//
// Behaviour is unchanged: same transferAndCall flow, same match polling, same
// contract integration. This is a layout + visual identity pass.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { encodeAbiParameters, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, ARENA_PLATFORM_ABI, ERC20_ABI } from "@/lib/contracts";
import {
  GAME_TYPES, WAGER_TIERS, MARKOV, TAUNTS_BY_TIER,
  type GameType, type WagerTier, MATCH_STATUS,
  type ArenaMatch,
} from "@/lib/challengeAi";

// Pre-match flavor uses the AI's "win" pool — trash talk before the punch.
// Tone scales with tier: warmup is gentle, highroller swaggers.
const TIER_TAUNTS: Record<string, string[]> = {
  warmup:     TAUNTS_BY_TIER.warmup.win,
  staked:     TAUNTS_BY_TIER.staked.win,
  highroller: TAUNTS_BY_TIER.highroller.win,
};

export default function ChallengeAiHubPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Picker state
  const [game, setGame]   = useState<GameType>(GAME_TYPES[0]);
  const [tier, setTier]   = useState<WagerTier>(WAGER_TIERS[1]); // STAKED default
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotating taunt — switches every 5s within the current tier's pool.
  // Restarts at index 0 whenever the tier itself changes so the player sees
  // a fresh line on selection (small but meaningful feedback signal).
  const [tauntIdx, setTauntIdx] = useState(0);
  useEffect(() => { setTauntIdx(0); }, [tier.id]);
  useEffect(() => {
    const pool = TIER_TAUNTS[tier.id] ?? [];
    if (pool.length <= 1) return;
    const t = setInterval(() => setTauntIdx(i => (i + 1) % pool.length), 5000);
    return () => clearInterval(t);
  }, [tier.id]);
  const taunt = (TIER_TAUNTS[tier.id] ?? [])[tauntIdx] ?? tier.epithet;

  // Player's G$ balance — displayed in the top bar so stakes feel real.
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

  // Match history — drives "Your Last Battles" strip + active-match shortcuts.
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

  // Active matches (your turn / waiting) and a compact last-5 battles strip.
  const active = useMemo(() => matches.filter(m =>
    m.status === MATCH_STATUS.ACCEPTED || m.status === MATCH_STATUS.PROPOSED
  ), [matches]);
  const recent = useMemo(() => matches.filter(m =>
    m.status === MATCH_STATUS.COMPLETED
  ).slice(0, 5), [matches]);

  // Win streak = how many of your most-recent completed matches you won in
  // a row before any loss. Shown in top bar as a 🔥 chip — visible reward
  // for retention even when there's no active match.
  const winStreak = useMemo(() => {
    let s = 0;
    for (const m of recent) {
      if (!address) break;
      if (m.winner.toLowerCase() === address.toLowerCase()) s++;
      else break;
    }
    return s;
  }, [recent, address]);

  // Challenge submission — encoded transferAndCall as before.
  async function onChallenge() {
    if (busy) return;
    if (!isConnected || !address) { setError("Connect your wallet first."); return; }
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
      setBusy(false);
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
      {/* ─── Arena ambient ─────────────────────────────────────────────── */}
      <ArenaAmbient tierColor={tier.color} tierGlow={tier.glow} />

      <div style={{
        position: "relative", zIndex: 1,
        maxWidth: 560, margin: "0 auto",
        padding: "16px 14px 28px",
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        {/* Top bar — back button · streak · balance */}
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
            color: "rgba(216,180,254,0.55)",
            fontSize: 9, fontWeight: 800, letterSpacing: "0.32em",
          }}>VERIFIED ON-CHAIN OPPONENT</div>
          <div style={{
            color: "white", fontSize: 18, fontWeight: 900,
            letterSpacing: "0.14em", marginTop: 4,
          }}>{MARKOV.name.toUpperCase()}</div>
        </div>

        {/* HERO portrait + persona + stats */}
        <PortraitHero tier={tier} taunt={taunt} />

        {/* Decision row — tier picker (3 chips) + game picker (2 chips) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>SELECT INTENSITY</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {WAGER_TIERS.map(t => (
              <TierChip key={t.id} tier={t} selected={tier.id === t.id} onSelect={() => setTier(t)} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>PICK THE GAME</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {GAME_TYPES.map(g => (
              <GameChip key={g.id} game={g} selected={game.id === g.id} onSelect={() => setGame(g)} />
            ))}
          </div>
        </div>

        {/* Hero challenge button */}
        <ChallengeButton tier={tier} game={game} busy={busy} onClick={onChallenge} />

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5", fontSize: 12, fontWeight: 700,
            textAlign: "center",
          }}>{error}</div>
        )}

        {/* Tie-rule reminder — short and clean, not its own card */}
        <div style={{
          color: "rgba(134,239,172,0.75)", fontSize: 11, fontWeight: 800,
          letterSpacing: "0.06em", textAlign: "center",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>🛡️ <span>You win all ties</span></div>

        {/* Active matches — only if there are any */}
        {active.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>UNFINISHED BATTLES</SectionLabel>
            {active.map(m => (
              <ActiveMatchRow key={String(m.id)} m={m} onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
            ))}
          </div>
        )}

        {/* Last 5 battles — emoji vs emoji format, story at a glance */}
        {recent.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel>YOUR LAST {recent.length} BATTLE{recent.length === 1 ? "" : "S"}</SectionLabel>
            {recent.map(m => (
              <BattleRow key={String(m.id)} m={m} address={address} onOpen={() => router.push(`/games/challenge-ai/match/${m.id}`)} />
            ))}
          </div>
        )}

        {/* Footnote */}
        <div style={{
          color: "rgba(200,180,255,0.42)",
          fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
          textAlign: "center", marginTop: 4, lineHeight: 1.5,
        }}>
          ERC-8004 verified · All matches settle on Celo · Wager goes to winner
        </div>
      </div>
    </div>
  );
}

// ─── ArenaAmbient ────────────────────────────────────────────────────────────
// Background ambient — radial glow tinted by the selected tier + slow drifting
// hexagonal grid. Pure CSS, no JS animation cost.
function ArenaAmbient({ tierColor, tierGlow }: { tierColor: string; tierGlow: string }) {
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      <div style={{
        position: "absolute", top: "-15%", left: "50%", transform: "translateX(-50%)",
        width: "min(140vw, 900px)", height: "min(140vw, 900px)", borderRadius: "50%",
        background: `radial-gradient(circle, ${tierGlow} 0%, transparent 60%)`,
        filter: "blur(40px)", opacity: 0.7,
        transition: "background 0.5s",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `linear-gradient(${tierColor}11 1px, transparent 1px), linear-gradient(90deg, ${tierColor}11 1px, transparent 1px)`,
        backgroundSize: "44px 44px",
        opacity: 0.4,
        animation: "arenaGrid 60s linear infinite",
        maskImage: "radial-gradient(circle at center, black 0%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(circle at center, black 0%, transparent 75%)",
      }} />
      <style jsx>{`
        @keyframes arenaGrid {
          from { background-position: 0 0, 0 0; }
          to   { background-position: 44px 44px, 44px 44px; }
        }
      `}</style>
    </div>
  );
}

// ─── PortraitHero ───────────────────────────────────────────────────────────
// The opponent owns the screen. Portrait card with breathing animation +
// persona name, epithet, three stat bars, and the rotating taunt below.
function PortraitHero({ tier, taunt }: { tier: WagerTier; taunt: string }) {
  const [imgOk, setImgOk] = useState(true);
  // Reset img state on tier change so a previously-broken image is retried
  useEffect(() => { setImgOk(true); }, [tier.id]);

  return (
    <div style={{
      position: "relative",
      borderRadius: 22, background: tier.wall, paddingBottom: 5,
      boxShadow: `0 18px 40px -8px ${tier.glow}, 0 0 0 1.5px ${tier.color}66`,
      transition: "all 0.4s",
    }}>
      <div style={{
        borderRadius: "20px 20px 16px 16px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.55) 100%), " + tier.face,
        border: "2px solid rgba(255,255,255,0.18)",
        padding: "18px 18px 20px",
        position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* Top gloss */}
        <div style={{
          position: "absolute", top: 2, left: "5%", right: "5%", height: "30%",
          background: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)",
          borderRadius: "20px 20px 60px 60px", pointerEvents: "none",
        }} />

        {/* Persona name + epithet */}
        <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
          <div style={{
            color: "white", fontSize: 22, fontWeight: 900,
            letterSpacing: "0.06em",
            textShadow: "0 2px 6px rgba(0,0,0,0.5)",
          }}>{tier.persona}</div>
          <div style={{
            color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.04em", marginTop: 2,
            textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}>{tier.epithet}</div>
        </div>

        {/* Portrait area — image if present, gradient + emoji fallback */}
        <div style={{
          position: "relative", zIndex: 1,
          width: "100%", aspectRatio: "1 / 1", maxHeight: 280,
          borderRadius: 18,
          background: `radial-gradient(circle, ${tier.color}33 0%, rgba(0,0,0,0.6) 70%)`,
          border: `2px solid ${tier.color}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
          animation: "heroBreath 4s ease-in-out infinite",
        }}>
          {imgOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tier.portrait}
              alt={tier.persona}
              onError={() => setImgOk(false)}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                filter: `drop-shadow(0 8px 18px ${tier.glow})`,
              }}
            />
          ) : (
            <div style={{
              fontSize: 120, lineHeight: 1,
              filter: `drop-shadow(0 8px 18px ${tier.glow})`,
            }}>{MARKOV.emoji}</div>
          )}
          {/* Scanline overlay — sells the "AI" feel without an extra asset */}
          <div aria-hidden style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(255,255,255,0.04) 3px, rgba(255,255,255,0.04) 4px)",
            mixBlendMode: "overlay",
          }} />
        </div>

        {/* Stat bars */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <StatBar label="AGGRESSION"   value={tier.stats.aggression}   color={tier.color} />
          <StatBar label="ADAPTABILITY" value={tier.stats.adaptability} color={tier.color} />
          <StatBar label="DIFFICULTY"   value={tier.stats.difficulty}   color={tier.color} />
        </div>

        {/* Rotating taunt */}
        <div
          key={taunt}
          style={{
            position: "relative", zIndex: 1,
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(0,0,0,0.42)",
            border: "1px solid rgba(255,255,255,0.18)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12, fontWeight: 700, fontStyle: "italic",
            textAlign: "center", lineHeight: 1.4,
            animation: "tauntFade 600ms ease-out",
          }}
        >“{taunt}”</div>

        <style jsx>{`
          @keyframes heroBreath {
            0%, 100% { transform: scale(1); }
            50%      { transform: scale(1.012); }
          }
          @keyframes tauntFade {
            from { opacity: 0; transform: translateY(4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        flexShrink: 0, width: 88,
        color: "rgba(255,255,255,0.75)", fontSize: 9, fontWeight: 800,
        letterSpacing: "0.14em",
      }}>{label}</div>
      <div style={{
        flex: 1, height: 6, borderRadius: 3,
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.1)",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${value}%`, height: "100%",
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          boxShadow: `0 0 8px ${color}99`,
          borderRadius: 3,
          transition: "width 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      </div>
      <div style={{
        flexShrink: 0, width: 30, textAlign: "right",
        color: "rgba(255,255,255,0.92)", fontSize: 10, fontWeight: 900,
        fontFamily: "monospace",
      }}>{value}</div>
    </div>
  );
}

// ─── Decision row chips ────────────────────────────────────────────────────
function TierChip({ tier, selected, onSelect }: { tier: WagerTier; selected: boolean; onSelect: () => void }) {
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter") onSelect(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 14,
        background: selected ? tier.wall : "rgba(255,255,255,0.03)",
        paddingBottom: selected ? 4 : 0,
        boxShadow: selected
          ? `0 8px 22px -4px ${tier.glow}, 0 0 0 1.5px ${tier.color}`
          : "0 0 0 1px rgba(255,255,255,0.08)",
        transition: "all 0.18s",
      }}
    >
      <div style={{
        borderRadius: selected ? "12px 12px 10px 10px" : "14px",
        background: selected ? tier.face : "rgba(20,10,50,0.55)",
        border: selected ? "2px solid rgba(255,255,255,0.4)" : "1px solid rgba(255,255,255,0.06)",
        padding: "10px 6px",
        textAlign: "center",
        display: "flex", flexDirection: "column", gap: 2,
        position: "relative", overflow: "hidden",
        boxShadow: selected ? "inset 0 6px 14px rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.3)" : "none",
      }}>
        {selected && (
          <div aria-hidden style={{
            position: "absolute", top: 2, left: "8%", right: "8%", height: "44%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 100%)",
            borderRadius: "12px 12px 50px 50px", pointerEvents: "none",
          }} />
        )}
        <div style={{
          color: selected ? "white" : "rgba(229,231,235,0.78)",
          fontSize: 9, fontWeight: 900, letterSpacing: "0.12em",
          position: "relative", zIndex: 1,
          textShadow: selected ? "0 1px 2px rgba(0,0,0,0.5)" : "none",
        }}>{tier.name}</div>
        <div style={{
          color: selected ? "white" : tier.color,
          fontSize: 18, fontWeight: 900, lineHeight: 1.05,
          position: "relative", zIndex: 1,
          textShadow: selected ? "0 2px 4px rgba(0,0,0,0.4)" : `0 0 8px ${tier.color}aa`,
        }}>{tier.amount}<span style={{ fontSize: 9, marginLeft: 2 }}>G$</span></div>
      </div>
    </div>
  );
}

function GameChip({ game, selected, onSelect }: { game: GameType; selected: boolean; onSelect: () => void }) {
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter") onSelect(); }}
      style={{
        cursor: "pointer", userSelect: "none",
        borderRadius: 14,
        background: selected ? "linear-gradient(180deg, #fde68a 0%, #f59e0b 100%)" : "rgba(255,255,255,0.03)",
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
        padding: "12px 10px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ fontSize: 24 }}>
          {game.moves[0].emoji}{game.moves[1] ? game.moves[1].emoji : ""}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            color: selected ? "#fde68a" : "rgba(229,231,235,0.92)",
            fontSize: 11, fontWeight: 900, letterSpacing: "0.1em",
          }}>{game.shortName}</div>
          <div style={{
            color: selected ? "rgba(254,215,170,0.7)" : "rgba(200,180,255,0.5)",
            fontSize: 9, fontWeight: 700, marginTop: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{game.moveCount}-move game</div>
        </div>
      </div>
    </div>
  );
}

// ─── ChallengeButton ─────────────────────────────────────────────────────────
function ChallengeButton({ tier, game, busy, onClick }: {
  tier: WagerTier; game: GameType; busy: boolean; onClick: () => void;
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
      }}
      onMouseDown={e => { if (!busy) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.985) translateY(2px)"; }}
      onMouseUp={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; }}
    >
      <div style={{
        borderRadius: 18, background: tier.wall, paddingBottom: 6,
        boxShadow: `0 16px 36px -6px ${tier.glow}, 0 0 0 2px ${tier.color}66`,
      }}>
        <div style={{
          borderRadius: "16px 16px 12px 12px",
          background: tier.face,
          padding: "16px 18px", textAlign: "center",
          border: "2px solid rgba(255,255,255,0.45)",
          boxShadow: "inset 0 6px 14px rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.3)",
          position: "relative", overflow: "hidden",
        }}>
          <div aria-hidden style={{
            position: "absolute", top: 2, left: "4%", right: "4%", height: "48%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.65) 0%, transparent 100%)",
            borderRadius: "12px 12px 60px 60px", pointerEvents: "none",
          }} />
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{
              color: "white", fontSize: 15, fontWeight: 900, letterSpacing: "0.14em",
              textShadow: "0 2px 4px rgba(0,0,0,0.4)",
            }}>
              {busy ? "OPENING…" : `CHALLENGE ${tier.persona.toUpperCase()}`}
            </div>
            <div style={{
              color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em",
            }}>
              {game.shortName} · {tier.amount} G$ stake · winner takes pot
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small UI bits ──────────────────────────────────────────────────────────
function CircleBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 36, height: 36, borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white", fontSize: 16, fontWeight: 900, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
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
      <span style={{
        color: "#fbbf24", fontSize: 11, fontWeight: 900,
        letterSpacing: "0.04em",
      }}>{streak}</span>
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
      <span style={{
        color: "rgba(134,239,172,0.8)", fontSize: 9, fontWeight: 800,
        letterSpacing: "0.14em",
      }}>G$</span>
      <span style={{
        color: "#86efac", fontSize: 12, fontWeight: 900,
        fontFamily: "monospace",
      }}>{balance}</span>
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
        <div style={{
          color: "white", fontSize: 12, fontWeight: 900,
          letterSpacing: "0.06em",
        }}>#{String(m.id)} · {wager} G$ · {m.gameType === 0 ? "RPS" : "COIN"}</div>
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
  // We don't fetch each match's moves here (too many reads) — just a compact
  // outcome line. The match page shows full move details on tap.
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
        <div style={{
          color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: 900,
          letterSpacing: "0.04em",
        }}>#{String(m.id)} · {gameLabel}</div>
        <div style={{
          color: youWon ? "#86efac" : "#fca5a5",
          fontSize: 10, fontWeight: 800, letterSpacing: "0.14em",
        }}>{youWon ? `+${(parseFloat(wager) * 1.9).toFixed(2)} G$ · YOU WON` : `−${wager} G$ · MARKOV WON`}</div>
      </div>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, fontWeight: 900 }}>›</div>
    </div>
  );
}
