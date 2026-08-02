"use client";

// ─── AgentArena · the "your agent plays" side of the Challenge AI lobby ──────
// A player deploys an agent on GoodAgents; that agent is attached to their
// wallet, mints a GameArena GamePass, and grinds MARKOV on its own. This panel
// is where the owner meets it: it looks the wallet up, shows the agent as a
// first-class named competitor, and — the moment the agent steps into a match —
// streams the fight live, round by round, over the same SSE feed a spectator
// on any partner site would watch. No agent yet? One tap to go deploy one.
//
// Everything here is real data: the owner→agent lookup is Samuel's partner
// endpoint (via useOwnedAgents), and the live feed is our backend's
// GET /api/arena/live/:matchId.

import { useEffect, useRef, useState } from "react";
import { useOwnedAgents, type OwnedAgent } from "@/hooks/useOwnedAgents";
import { playAgentMatch } from "@/app/actions/arena";

// Follows whichever backend the app points at (local:3005 in dev, Railway in
// prod). Samuel's lookup usually hands us a full liveWatchUrl; this is only the
// fallback when it doesn't.
const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://game-backend-production-6130.up.railway.app";
const LIVE_BASE = `${BACKEND}/api/arena/live`;

const T = {
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  inkSoft: "rgba(220,210,255,0.45)",
  hairline: "rgba(255,255,255,0.08)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};
const CYAN = "#22d3ee";
const CYAN_SOFT = "#67e8f9";
const AI_GREEN = "#22c55e";
const RIM = "#fbbf24";

const MARKOV_ART = "/games/challenge-ai-v2/ai-bot-medium.png";
const MOVE_ART = [
  "/games/challenge-ai-v2/moves/rock.png",
  "/games/challenge-ai-v2/moves/paper.png",
  "/games/challenge-ai-v2/moves/scissors.png",
];
const MOVE_NAME = ["ROCK", "PAPER", "SCISSORS"];

// ─── one round as it arrives off the SSE stream ──────────────────────────────
type LiveRound = {
  round: number;
  playerMove: number; // the agent's move
  aiMove: number;     // MARKOV's move
  result: "win" | "loss" | "tie" | string;
  score: { player: number; ai: number; ties: number };
  markovLine?: string | null;
};
type LiveFinal = {
  outcome?: string;
  seed?: string;
  commitHash?: string;
  rounds?: number;
};

export default function AgentArena({
  wallet,
  onBack,
  onDeploy,
}: {
  wallet?: string;
  onBack: () => void;
  onDeploy: () => void;
}) {
  // Poll the lookup every 5s so a fresh activeMatchId flips us into the live
  // view without the player doing anything.
  const { agents, loading, hasAgent } = useOwnedAgents([wallet], 5000);
  const agent = pickAgent(agents);

  return (
    <div style={{ animation: "riseIn 0.35s ease both", minHeight: "calc(100dvh - 230px)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button
          onClick={onBack}
          style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${T.hairline}`, color: T.inkDim, borderRadius: 999, padding: "7px 13px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: T.body }}
        >
          ← Back
        </button>
        <span style={{ fontFamily: T.display, fontSize: 15, color: CYAN_SOFT, letterSpacing: "0.04em" }}>
          🤖 YOUR AGENT
        </span>
      </div>

      {loading && !agent && <Skeleton />}
      {!loading && !hasAgent && <NoAgent onDeploy={onDeploy} />}
      {agent && <AgentBody agent={agent} />}
    </div>
  );
}

// Prefer an agent that's live right now; else the first one.
function pickAgent(agents: OwnedAgent[]): OwnedAgent | null {
  if (agents.length === 0) return null;
  return agents.find((a) => a.activeMatchId) ?? agents[0]!;
}

// ═══ states ══════════════════════════════════════════════════════════════════

function Skeleton() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, color: T.inkSoft, fontFamily: T.body, fontSize: 13 }}>
      <div style={{ width: 46, height: 46, borderRadius: "50%", border: `3px solid ${T.hairline}`, borderTopColor: CYAN, animation: "spin 0.8s linear infinite" }} />
      Looking up your agent…
    </div>
  );
}

function NoAgent({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 8px" }}>
      <div style={{ fontSize: 54, marginBottom: 6, filter: "grayscale(0.2)" }}>🤖</div>
      <div style={{ fontFamily: T.display, fontSize: 22, color: "#fff", letterSpacing: "0.03em" }}>
        Deploy an agent to play for you
      </div>
      <div style={{ fontFamily: T.body, fontSize: 13, color: T.inkDim, fontWeight: 600, lineHeight: 1.5, maxWidth: 320, margin: "10px 0 22px" }}>
        Spin up your own AI on GoodAgents. It gets a name, mints your GamePass, and grinds MARKOV on the board while you watch the matches live.
      </div>
      <div
        role="button"
        onClick={onDeploy}
        style={{ cursor: "pointer", userSelect: "none", borderRadius: 18, background: "#083344", paddingBottom: 6, boxShadow: `0 12px 26px -6px ${CYAN}66, inset 0 -3px 8px rgba(0,0,0,0.4)`, width: "100%", maxWidth: 320 }}
      >
        <div style={{ borderRadius: "16px 16px 12px 12px", background: `linear-gradient(160deg, #a5f3fc 0%, ${CYAN} 50%, #0e7490 100%)`, padding: "16px 20px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.55), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center" }}>
          <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
          <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: 17, color: "#062c38", letterSpacing: "0.04em" }}>
            DEPLOY MY AGENT
          </span>
        </div>
      </div>
    </div>
  );
}

function AgentBody({ agent }: { agent: OwnedAgent }) {
  // Hybrid model: the agent is deployed once in the widget (the on-chain sign +
  // stake step). Everything after that is native here — the player taps "play
  // with your agent" and watches the match live, just like manual play. The
  // match id comes from a player-launched match or one the lookup already
  // reports (activeMatchId).
  const [launched, setLaunched] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const matchId = launched || agent.activeMatchId || null;
  const name = agent.displayName || "Your agent";

  const play = async () => {
    setStarting(true);
    setErr(null);
    const out = await playAgentMatch(agent.agentAddress);
    setStarting(false);
    if (out.matchId) setLaunched(out.matchId);
    else setErr(out.error === "backend_unreachable" ? "Arena is unreachable right now." : "Couldn't start the match. Try again.");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <AgentCard agent={agent} live={!!matchId} />
      {matchId ? (
        <LiveMatch
          key={matchId}
          matchId={matchId}
          watchUrl={agent.activeMatchId === matchId ? agent.liveWatchUrl ?? null : null}
          agentName={name}
          onPlayAgain={launched === matchId ? () => { setLaunched(null); setErr(null); } : undefined}
        />
      ) : (
        <PlayWithAgent name={name} starting={starting} err={err} onPlay={play} />
      )}
    </div>
  );
}

// Native "play with your agent" surface — feels like the manual FIGHT button.
// The player taps it, their deployed agent steps into MARKOV, and the match
// streams live right here. (The start currently routes through our stand-in
// driver; it swaps to GoodAgents' real start-match call when Samuel ships it.)
function PlayWithAgent({ name, starting, err, onPlay }: { name: string; starting: boolean; err: string | null; onPlay: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 8px" }}>
      <div style={{ position: "relative" }}>
        <img src={MARKOV_ART} alt="MARKOV" style={{ width: "min(44vw, 160px)", height: "auto", objectFit: "contain", animation: "idleBob 3.2s ease-in-out infinite", opacity: starting ? 0.85 : 1 }} />
        <div aria-hidden style={{ width: "42vw", maxWidth: 150, height: 24, borderRadius: "50%", background: `radial-gradient(ellipse, ${CYAN}44 0%, transparent 70%)`, filter: "blur(5px)", margin: "-8px auto 0" }} />
      </div>
      <div style={{ fontFamily: T.display, fontSize: 19, color: "#fff", marginTop: 8, letterSpacing: "0.03em" }}>
        {starting ? "Stepping into the ring…" : `${name === "Your agent" ? "Your agent" : name} vs MARKOV`}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.inkDim, fontWeight: 600, lineHeight: 1.5, maxWidth: 300, marginTop: 6 }}>
        Send your agent in and watch it play MARKOV live, round by round. Best of 5, first to 3 wins.
      </div>

      {err && <div style={{ marginTop: 12, fontFamily: T.body, fontSize: 12, color: "#fca5a5" }}>{err}</div>}

      <div
        role="button"
        onClick={starting ? undefined : onPlay}
        style={{ cursor: starting ? "wait" : "pointer", userSelect: "none", borderRadius: 18, background: "#083344", paddingBottom: 6, boxShadow: `0 12px 26px -6px ${CYAN}66, inset 0 -3px 8px rgba(0,0,0,0.4)`, width: "100%", maxWidth: 320, marginTop: 20, transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1)" }}
        onMouseDown={(e) => { if (!starting) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(3px)"; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
      >
        <div style={{ borderRadius: "16px 16px 12px 12px", background: starting ? "rgba(34,211,238,0.4)" : `linear-gradient(160deg, #a5f3fc 0%, ${CYAN} 50%, #0e7490 100%)`, padding: "16px 20px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.55), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center" }}>
          <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
          <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: 17, color: "#062c38", letterSpacing: "0.04em" }}>
            {starting ? "SUMMONING MARKOV…" : "🤖 PLAY WITH YOUR AGENT"}
          </span>
        </div>
      </div>
      <div style={{ marginTop: 10, fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700 }}>
        🔒 provably fair · streams live
      </div>
    </div>
  );
}

function AgentCard({ agent, live }: { agent: OwnedAgent; live: boolean }) {
  const short = `${agent.agentAddress.slice(0, 6)}…${agent.agentAddress.slice(-4)}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.4)", border: `1px solid rgba(34,211,238,0.25)`, borderRadius: 16, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(34,211,238,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>
        🤖
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: T.display, fontSize: 16, color: "#fff", letterSpacing: "0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.displayName || "Your agent"}
          </span>
          <span style={{ fontSize: 9, fontWeight: 800, color: CYAN_SOFT, background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 999, padding: "2px 6px", letterSpacing: "0.06em", flexShrink: 0 }}>
            VERIFIED
          </span>
        </div>
        <div style={{ fontFamily: T.body, fontSize: 11, color: T.inkSoft, fontWeight: 600, marginTop: 2 }}>
          {agent.gamePassUsername ? `@${agent.gamePassUsername} · ${short}` : short}
        </div>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 10.5, fontWeight: 800, color: live ? "#fca5a5" : T.inkSoft, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: live ? "#ef4444" : T.inkSoft, boxShadow: live ? "0 0 8px #ef4444" : "none", animation: live ? "livePulse 1.2s ease-in-out infinite" : "none" }} />
        {live ? "LIVE" : "IDLE"}
      </span>
    </div>
  );
}

// ═══ live match viewer ═════════════════════════════════════════════════════════
function LiveMatch({ matchId, watchUrl, agentName, onPlayAgain }: { matchId: string; watchUrl: string | null; agentName: string; onPlayAgain?: () => void }) {
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [score, setScore] = useState({ player: 0, ai: 0, ties: 0 });
  const [line, setLine] = useState<string | null>(null);
  const [ended, setEnded] = useState<LiveFinal | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = watchUrl || `${LIVE_BASE}/${matchId}`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }
    es.onopen = () => setConnected(true);
    es.onmessage = (ev) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      const type = frame.type;
      if (type === "hello") {
        setConnected(true);
        return;
      }
      if (type === "round") {
        const r = frame as unknown as LiveRound;
        setRounds((prev) => (prev.some((p) => p.round === r.round) ? prev : [...prev, r]));
        if (r.score) setScore(r.score);
        if (r.markovLine) setLine(r.markovLine);
      }
      if (type === "end") {
        // The end frame is the final round: it carries that round's move + the
        // final score alongside `final`. Apply them so a late joiner (who missed
        // the per-round frames) still sees the real result, not 0–0.
        const r = frame as unknown as LiveRound;
        if (typeof r.round === "number" && typeof r.playerMove === "number") {
          setRounds((prev) => (prev.some((p) => p.round === r.round) ? prev : [...prev, r]));
        }
        if (r.score) setScore(r.score);
        if (r.markovLine) setLine(r.markovLine);
        const f = (frame.final || {}) as LiveFinal;
        setEnded(f);
        es?.close();
      }
    };
    es.onerror = () => setConnected(false);
    return () => es?.close();
  }, [matchId, watchUrl]);

  // keep the round feed scrolled to the newest
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rounds.length]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* scoreboard: agent vs MARKOV */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 12 }}>
        <Side label={agentName || "Your agent"} value={score.player} color={CYAN_SOFT} align="right" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: T.display, fontSize: 13, color: "#fff", opacity: 0.5 }}>vs</div>
          <div style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 800, color: RIM, letterSpacing: "0.06em", marginTop: 2 }}>FIRST TO 3</div>
          <div style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, letterSpacing: "0.08em", marginTop: 1 }}>{score.ties} TIES</div>
        </div>
        <Side label="MARKOV" value={score.ai} color="#86efac" align="left" />
      </div>

      {/* the most recent clash, big */}
      {rounds.length > 0 && (
        <LatestClash r={rounds[rounds.length - 1]!} line={line} />
      )}

      {!connected && !ended && rounds.length === 0 && (
        <div style={{ textAlign: "center", color: T.inkSoft, fontFamily: T.body, fontSize: 12, padding: "20px 0" }}>
          Connecting to the live feed…
        </div>
      )}

      {/* round-by-round tape */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 6, minHeight: 0, maxHeight: 220 }}>
        {rounds.map((r) => (
          <RoundRow key={r.round} r={r} />
        ))}
      </div>

      {ended && <MatchEnd final={ended} score={score} agentName={agentName} onPlayAgain={onPlayAgain} />}
    </div>
  );
}

function Side({ label, value, color, align }: { label: string; value: number; color: string; align: "left" | "right" }) {
  return (
    <div style={{ textAlign: align, flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: T.body, fontSize: 11, fontWeight: 800, color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ fontFamily: T.display, fontSize: 40, color: "#fff", lineHeight: 1, textShadow: `0 0 20px ${color}55` }}>
        {value}
      </div>
    </div>
  );
}

function LatestClash({ r, line }: { r: LiveRound; line: string | null }) {
  const win = r.result === "win";
  const tie = r.result === "tie";
  const tone = win ? CYAN_SOFT : tie ? RIM : "#fca5a5";
  return (
    <div key={r.round} style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${T.hairline}`, borderRadius: 16, padding: "14px 12px", animation: "bubblePop 0.35s cubic-bezier(0.22,1.4,0.36,1) both" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <MoveChip move={r.playerMove} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: T.display, fontSize: 12, color: tone, letterSpacing: "0.05em" }}>
            {win ? "AGENT WINS" : tie ? "TIE" : "MARKOV WINS"}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, marginTop: 2 }}>ROUND {r.round}</div>
        </div>
        <MoveChip move={r.aiMove} />
      </div>
      {line && (
        <div style={{ textAlign: "center", marginTop: 10, fontFamily: T.body, fontStyle: "italic", fontSize: 11.5, color: "rgba(240,230,255,0.85)" }}>
          “{line}”
        </div>
      )}
    </div>
  );
}

function MoveChip({ move }: { move: number }) {
  const art = MOVE_ART[move];
  return (
    <div style={{ textAlign: "center" }}>
      {art ? (
        <img src={art} alt={MOVE_NAME[move]} style={{ width: 56, height: 56, objectFit: "contain" }} />
      ) : (
        <div style={{ width: 56, height: 56 }} />
      )}
      <div style={{ fontFamily: T.body, fontSize: 9.5, color: T.inkSoft, fontWeight: 800, letterSpacing: "0.05em" }}>
        {MOVE_NAME[move] ?? "—"}
      </div>
    </div>
  );
}

function RoundRow({ r }: { r: LiveRound }) {
  const win = r.result === "win";
  const tie = r.result === "tie";
  const dot = win ? CYAN : tie ? RIM : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 11px", background: "rgba(0,0,0,0.28)", border: `1px solid ${T.hairline}`, borderRadius: 10, fontFamily: T.body }}>
      <span style={{ fontSize: 10, color: T.inkSoft, fontWeight: 800, width: 20 }}>R{r.round}</span>
      <span style={{ fontSize: 12, color: CYAN_SOFT, fontWeight: 700, flex: 1 }}>{MOVE_NAME[r.playerMove] ?? "—"}</span>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "#86efac", fontWeight: 700, flex: 1, textAlign: "right" }}>{MOVE_NAME[r.aiMove] ?? "—"}</span>
    </div>
  );
}

function MatchEnd({ final, score, agentName, onPlayAgain }: { final: LiveFinal; score: { player: number; ai: number; ties: number }; agentName: string; onPlayAgain?: () => void }) {
  const won = score.player > score.ai;
  const tie = score.player === score.ai;
  return (
    <div style={{ marginTop: 12, textAlign: "center", background: won ? "rgba(34,211,238,0.1)" : tie ? "rgba(251,191,36,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${won ? "rgba(34,211,238,0.4)" : tie ? "rgba(251,191,36,0.4)" : "rgba(239,68,68,0.4)"}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ fontFamily: T.display, fontSize: 18, color: won ? CYAN_SOFT : tie ? RIM : "#fca5a5", letterSpacing: "0.04em" }}>
        {won ? `${agentName || "Your agent"} won` : tie ? "Dead even" : "MARKOV took it"}
      </div>
      <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, fontWeight: 700, marginTop: 3 }}>
        Final {score.player}–{score.ai}
        {final.seed ? " · provably fair, seed revealed" : ""}
      </div>
      {onPlayAgain && (
        <button
          onClick={onPlayAgain}
          style={{ marginTop: 12, background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.4)", color: CYAN_SOFT, borderRadius: 999, padding: "9px 20px", fontFamily: T.display, fontSize: 13, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          ↻ Send in again
        </button>
      )}
    </div>
  );
}
