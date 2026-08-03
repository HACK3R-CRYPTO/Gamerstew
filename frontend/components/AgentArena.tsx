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
import toast from "react-hot-toast";
import { useSignMessage } from "wagmi";
import { useOwnedAgents, type OwnedAgent } from "@/hooks/useOwnedAgents";
import {
  goodAgentsPlay, goodAgentsPatchSettings, goodAgentsStart,
  type AgentSettingField,
} from "@/app/actions/goodagents";
import { getSchemaCached, getSettingsCached, invalidateSettings } from "@/lib/agentPrefetch";

// The exact message a player signs to authorise a deploy action — must match
// the host byte-for-byte (see GAMEARENA_PARTNER_API.md).
function deployMsg(action: string, deployId: string, issuedAt: number): string {
  return `GoodAgent deploy control\nAction: ${action}\nDeploy: ${deployId}\nIssued: ${issuedAt}`;
}

function errText(code?: string): string {
  switch (code) {
    case "unreachable": return "GoodAgents is unreachable right now.";
    case "AGENT_NOT_VERIFIED": return "Your agent isn't verified yet.";
    case "AGENT_BUSY": return "Your agent is already in a match.";
    case "NOT_PROVISIONED": return "Your agent isn't set up to play yet.";
    case "SKILL_NOT_INSTALLED": return "The arena skill isn't installed on your agent.";
    case "INVALID_SIGNATURE":
    case "SIGNATURE_EXPIRED":
    case "OWNER_AUTH_REQUIRED": return "Signature didn't verify. Try again.";
    case "GAMEARENA_FIRST_AGENT_ONLY": return "This works with your first agent only.";
    default: return "Couldn't start the match. Try again.";
  }
}

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
// The player's agent character · same chibi-armor family as MARKOV (green/teal
// = the agent's cyan identity), mirrored on the VS stage to face the boss.
const AGENT_ART = "/games/challenge-ai-v2/ai-bot-easy.png";

// Every agent gets its own armor color: hash the agent address into one of 12
// hue steps and rotate the base art's palette. Deterministic — the same agent
// always wears the same colors, on the VS stage, the live card, everywhere.
// (Stage 2 is bought skins in the Arena Mall; this ships identity for free.)
export function agentHue(address: string): number {
  let h = 0;
  for (const c of (address || "").toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 12) * 30;
}
const MOVE_ART = [
  "/games/challenge-ai-v2/moves/rock.png",
  "/games/challenge-ai-v2/moves/paper.png",
  "/games/challenge-ai-v2/moves/scissors.png",
];
const MOVE_NAME = ["ROCK", "PAPER", "SCISSORS"];

// ─── launch hook · the lobby drives the whole flow ───────────────────────────
// Wake (if paused) + play, signed by the owner, with toasts for every failure.
// No navigation in here: the caller stays wherever it is (the lobby) until a
// real match exists, then routes to the live view. This is what kills the
// intermediate "press play again" screen.
export type LaunchedMatch = { matchId: string; watchUrl: string | null };
export type LaunchPhase = "idle" | "signing" | "waking" | "starting";

export function useAgentLaunch(agent: OwnedAgent | null, signer?: string) {
  const { signMessageAsync } = useSignMessage();
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [match, setMatch] = useState<LaunchedMatch | null>(null);

  const play = async () => {
    if (!agent?.deployId || phase !== "idle") return;
    const owner = agent.ownerWallet || signer || "";
    try {
      if (agent.status === "paused" || agent.readyToPlay === false) {
        setPhase("signing");
        const wakeAt = Date.now();
        const wakeSig = await signMessageAsync({ message: deployMsg("resume", agent.deployId, wakeAt) });
        setPhase("waking");
        const woke = await goodAgentsStart(agent.deployId, { ownerWallet: signer || owner, issuedAt: wakeAt, signature: wakeSig });
        if (!woke.ok) { toast.error(errText(woke.error)); return; }
      }
      setPhase("signing");
      const issuedAt = Date.now();
      const signature = await signMessageAsync({ message: deployMsg("play", agent.deployId, issuedAt) });
      setPhase("starting");
      const out = await goodAgentsPlay(owner, { ownerWallet: signer || owner, issuedAt, signature });
      if (out.matchId) setMatch({ matchId: out.matchId, watchUrl: out.liveWatchUrl ?? null });
      else toast.error(errText(out.error));
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message || "";
      toast.error(/reject|denied|cancel/i.test(m) ? "You cancelled the signature." : "Wallet couldn't sign. Try again.");
    } finally {
      setPhase("idle");
    }
  };

  return { phase, match, play, clearMatch: () => setMatch(null) };
}

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
  autoPlay = true,
  strategyOverride = null,
  entry = "play",
  initialMatch = null,
}: {
  wallet?: string;
  onBack: () => void;
  onDeploy: () => void;
  // Launch the play flow as soon as the agent resolves. Tapping "SEND YOUR AI"
  // in the lobby IS the intent — no second button stop (time-to-fun rule). The
  // VS stage plays as the transition while the wallet prompt rises over it.
  autoPlay?: boolean;
  // Strategy picked in the lobby loadout · a change is signed+saved on play.
  strategyOverride?: string | null;
  // "play" = auto-launch the match; "settings" = open the editor directly
  // (lobby ⚙️) and Back/Done return straight to the lobby.
  entry?: "play" | "settings";
  // Match already launched from the lobby → open directly in the live view.
  initialMatch?: LaunchedMatch | null;
}) {
  // Poll the lookup every 5s so a fresh activeMatchId flips us into the live
  // view without the player doing anything.
  const { agents, loading, hasAgent } = useOwnedAgents([wallet], 5000);
  const agent = pickAgent(agents);
  const [screen, setScreen] = useState<"main" | "settings">(entry === "settings" ? "settings" : "main");
  // Auto-launch fires ONCE per visit to this panel. Lives up here because the
  // play body unmounts while settings is open — a body-local ref would reset on
  // the way back and re-fire the wallet prompt (the "back from settings starts
  // a match" bug).
  const autoFiredRef = useRef(false);
  // True while a match is on screen · the gear hides then (no mid-match
  // settings edits — the match context stays clean).
  const [matchLive, setMatchLive] = useState(false);

  const inSettings = screen === "settings" && !!agent;
  // Entered via the lobby ⚙️ → Back/Done return to the lobby, never to a
  // stranded main panel (this screen is not a destination).
  const settingsExit = entry === "settings" ? onBack : () => setScreen("main");

  return (
    <div style={{ animation: "riseIn 0.35s ease both", minHeight: "min(calc(100dvh - 230px), 640px)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button
          onClick={inSettings ? settingsExit : onBack}
          style={{ background: "rgba(0,0,0,0.4)", border: `1px solid ${T.hairline}`, color: T.inkDim, borderRadius: 999, padding: "7px 13px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: T.body }}
        >
          ← Back
        </button>
        <span style={{ fontFamily: T.display, fontSize: 15, color: CYAN_SOFT, letterSpacing: "0.04em", flex: 1 }}>
          {inSettings ? "⚙️ AGENT SETTINGS" : "🤖 YOUR AGENT"}
        </span>
        {agent && !inSettings && !matchLive && (
          <button
            onClick={() => setScreen("settings")}
            title="Agent settings"
            style={{ background: "rgba(34,211,238,0.1)", border: "1px solid rgba(34,211,238,0.3)", color: CYAN_SOFT, borderRadius: 999, width: 34, height: 34, fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            ⚙️
          </button>
        )}
      </div>

      {loading && !agent && <Skeleton />}
      {!loading && !hasAgent && <NoAgent onDeploy={onDeploy} />}
      {agent && inSettings && <SettingsScreen agent={agent} signer={wallet} onDone={settingsExit} />}
      {agent && !inSettings && <AgentBody agent={agent} signer={wallet} autoPlay={autoPlay && entry === "play" && !agent.dailyCapReached} strategyOverride={strategyOverride} onSettings={() => setScreen("settings")} onAbort={entry === "play" ? onBack : undefined} autoFiredRef={autoFiredRef} onLiveChange={setMatchLive} initialMatch={initialMatch} />}
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

function AgentBody({ agent, signer, autoPlay, strategyOverride, onSettings, onAbort, autoFiredRef, onLiveChange, initialMatch }: { agent: OwnedAgent; signer?: string; autoPlay?: boolean; strategyOverride?: string | null; onSettings?: () => void; onAbort?: () => void; autoFiredRef?: React.MutableRefObject<boolean>; onLiveChange?: (live: boolean) => void; initialMatch?: LaunchedMatch | null }) {
  // Hybrid model: the agent is deployed once in the widget (the on-chain sign +
  // stake step). Everything after that is native here — the player taps "play
  // with your agent", signs one message, and GoodAgents starts a real MARKOV
  // match; we stream it live. The match id comes from that launch or one the
  // lookup already reports (activeMatchId).
  const { signMessageAsync } = useSignMessage();
  const [launched, setLaunched] = useState<{ matchId: string; watchUrl: string | null } | null>(initialMatch ?? null);
  const [matchDone, setMatchDone] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "saving" | "waking" | "starting">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Loadout: the ONE pre-match choice (strategy). Loaded from the host so the
  // chips reflect reality; changing it bundles a signed save into the play tap.
  const [strategy, setStrategy] = useState<string | null>(null);
  const [savedStrategy, setSavedStrategy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSettingsCached(agent.ownerWallet || signer || "").then((s) => {
      if (cancelled) return;
      const cur = (s.configuration?.MARKOV_STRATEGY as string) || "random";
      // Lobby loadout wins: if the player picked a strategy there, carry it in
      // (differs from saved → play() signs the save on the same tap).
      setStrategy(strategyOverride || cur);
      setSavedStrategy(cur);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.deployId]);

  const matchId = launched?.matchId || agent.activeMatchId || null;
  // Report the live state up so the header can hide the gear mid-match.
  useEffect(() => { onLiveChange?.(!!matchId); return () => onLiveChange?.(false); }, [matchId, onLiveChange]);
  const watchUrl = launched?.matchId
    ? launched.watchUrl
    : agent.activeMatchId
      ? agent.liveWatchUrl ?? null
      : null;
  const name = agent.displayName || "Your agent";
  const busy = phase !== "idle";

  // Terminal failure (or cancel) during an auto-launched flow: the VS stage is
  // a transition, not a place to strand people — toast the reason and return
  // to the lobby. Manual retries (no onAbort) keep the inline error.
  const fail = (msg: string) => {
    if (onAbort) { toast.error(msg); onAbort(); }
    else setErr(msg);
  };

  const play = async () => {
    if (!agent.deployId) { fail("Agent isn't ready yet. Try again in a moment."); return; }
    setErr(null);
    const owner = agent.ownerWallet || signer || "";
    try {
      // Loadout change rides along: if the player picked a different strategy,
      // sign + save it before the match so the agent actually plays that way.
      if (strategy && savedStrategy && strategy !== savedStrategy) {
        setPhase("signing");
        const saveAt = Date.now();
        const saveSig = await signMessageAsync({ message: deployMsg("configuration", agent.deployId, saveAt) });
        setPhase("saving");
        const saved = await goodAgentsPatchSettings(owner, {
          ownerWallet: signer || owner, issuedAt: saveAt, signature: saveSig,
          configuration: { MARKOV_STRATEGY: strategy },
        });
        if (!saved.ok) { fail(errText(saved.error)); return; }
        invalidateSettings(owner);
        setSavedStrategy(strategy);
      }
      // A paused agent can't play — wake it first (signed "resume"), then play.
      // Two signatures only in that case; a running agent signs once.
      if (agent.status === "paused" || agent.readyToPlay === false) {
        setPhase("signing");
        const wakeAt = Date.now();
        const wakeSig = await signMessageAsync({ message: deployMsg("resume", agent.deployId, wakeAt) });
        setPhase("waking");
        const woke = await goodAgentsStart(agent.deployId, { ownerWallet: signer || owner, issuedAt: wakeAt, signature: wakeSig });
        if (!woke.ok) { fail(errText(woke.error)); return; }
      }
      setPhase("signing");
      const issuedAt = Date.now();
      const signature = await signMessageAsync({ message: deployMsg("play", agent.deployId, issuedAt) });
      setPhase("starting");
      const out = await goodAgentsPlay(owner, { ownerWallet: signer || owner, issuedAt, signature });
      if (out.matchId) setLaunched({ matchId: out.matchId, watchUrl: out.liveWatchUrl ?? null });
      else fail(errText(out.error));
    } catch (e: unknown) {
      // User rejected the signature, or wallet threw.
      const msg = (e as { message?: string })?.message || "";
      fail(/reject|denied|cancel/i.test(msg) ? "You cancelled the signature." : "Wallet couldn't sign. Try again.");
    } finally {
      setPhase("idle");
    }
  };

  // One tap in the lobby = play. Fire the flow the moment the agent resolves;
  // if the player cancels the signature, the VS stage stays with the button as
  // the retry. Guarded so it fires once per visit.
  const autoFiredLocal = useRef(false);
  const autoFired = autoFiredRef ?? autoFiredLocal;
  useEffect(() => {
    if (!autoPlay || initialMatch || autoFired.current || !agent.deployId || matchId) return;
    autoFired.current = true;
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, agent.deployId, matchId]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {matchId ? (
        <>
          <AgentCard agent={agent} live={!matchDone} done={matchDone} />
          <LiveMatch
            key={matchId}
            matchId={matchId}
            watchUrl={watchUrl}
            agentName={name}
            agentAddress={agent.agentAddress}
            onEnded={() => setMatchDone(true)}
            onPlayAgain={launched?.matchId === matchId ? () => { setLaunched(null); setErr(null); setMatchDone(false); } : undefined}
          />
        </>
      ) : (
        <VersusStage agent={agent} phase={phase} busy={busy} err={err} onPlay={play} strategy={strategy} savedStrategy={savedStrategy} onStrategy={setStrategy} onSettings={onSettings} />
      )}
    </div>
  );
}

// ═══ VS stage · the pre-match face-off ═══════════════════════════════════════
// Genre-standard matchup screen: the player's agent squares up against MARKOV,
// VS emblem center, taunt on top — same visual grammar as the manual match's
// VsSting, so agent play feels like a first-class fight, not a settings form.
const AGENT_TAUNTS = [
  "send your little bot. i'll model it too.",
  "i've beaten smarter code than yours.",
  "your agent learns? cute. so do i.",
  "deploy it. i'll study it. i'll break it.",
];

// Strategy options mirror the host schema's MARKOV_STRATEGY enum (the full
// schema-driven editor lives in Settings; this strip is the quick loadout).
const STRATEGY_OPTIONS = [
  { id: "random", label: "🎲 Random" },
  { id: "counter", label: "🧠 Counter" },
  { id: "sequence", label: "🔁 Sequence" },
  { id: "fixed", label: "📌 Fixed" },
];

function VersusStage({ agent, phase, busy, err, onPlay, strategy, savedStrategy, onStrategy, onSettings }: { agent: OwnedAgent; phase: "idle" | "signing" | "saving" | "waking" | "starting"; busy: boolean; err: string | null; onPlay: () => void; strategy: string | null; savedStrategy: string | null; onStrategy: (s: string) => void; onSettings?: () => void }) {
  const name = agent.displayName || "Your agent";
  const changed = !!strategy && !!savedStrategy && strategy !== savedStrategy;
  // Daily cap spent → the play button becomes the fix (raise the cap in
  // settings), never a dead click or a doomed signature.
  const capped = !!agent.dailyCapReached;
  const label =
    phase === "signing" ? "CONFIRM IN YOUR WALLET…"
    : phase === "saving" ? "SAVING GAME PLAN…"
    : phase === "waking" ? "WAKING YOUR AGENT…"
    : phase === "starting" ? "SENDING AGENT IN…"
    : capped ? "⚙️ RAISE DAILY CAP"
    : changed ? "💾 SAVE & PLAY"
    : "🤖 PLAY WITH YOUR AGENT";
  const [tauntIdx, setTauntIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTauntIdx((i) => (i + 1) % AGENT_TAUNTS.length), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 2px" }}>
      {/* MARKOV talks down at the challenger · same boss voice as the lobby */}
      <div
        key={tauntIdx}
        style={{ alignSelf: "center", maxWidth: 300, background: "rgba(0,0,0,0.6)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 14, padding: "8px 14px", fontFamily: T.body, fontSize: 12, fontStyle: "italic", color: "rgba(240,230,255,0.92)", textAlign: "center", animation: "bubblePop 0.4s cubic-bezier(0.22,1.4,0.36,1) both", marginBottom: 18 }}
      >
        “{AGENT_TAUNTS[tauntIdx]}”
      </div>

      {/* the face-off · challenger slams in left, boss slams in right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        {/* your agent · the challenger — same presentation grammar as the boss:
            raw character art + floor glow, mirrored to face MARKOV */}
        <div style={{ flex: 1, maxWidth: 190, display: "flex", flexDirection: "column", alignItems: "center", animation: "slamL 0.45s cubic-bezier(0.22,1.2,0.36,1) both" }}>
          <img src={AGENT_ART} alt={name} style={{ width: "min(32vw, 128px)", height: "auto", objectFit: "contain", transform: "scaleX(-1)", animation: "idleBobAlt 2.8s ease-in-out infinite", filter: `hue-rotate(${agentHue(agent.agentAddress)}deg) drop-shadow(0 0 22px ${CYAN}55)` }} />
          <div aria-hidden style={{ width: "min(26vw, 100px)", height: 18, borderRadius: "50%", background: `radial-gradient(ellipse, ${CYAN}55 0%, transparent 70%)`, filter: "blur(5px)", marginTop: -6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
            <span style={{ fontFamily: T.display, fontSize: 17, color: "#fff", letterSpacing: "0.03em", textShadow: `0 0 18px ${CYAN}88` }}>{name}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
            {agent.verified !== false && (
              <span style={{ fontSize: 8.5, fontWeight: 800, color: CYAN_SOFT, background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 999, padding: "2px 7px", letterSpacing: "0.08em", fontFamily: T.body }}>VERIFIED</span>
            )}
            <span style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700 }}>your AI</span>
          </div>
        </div>

        {/* VS emblem */}
        <div style={{ fontFamily: T.display, fontSize: "min(9vw, 38px)", color: RIM, textShadow: `0 0 26px ${RIM}, 0 3px 6px rgba(0,0,0,0.6)`, animation: "vsPop 0.5s cubic-bezier(0.22,1.4,0.36,1) 0.25s both", flexShrink: 0, padding: "0 2px" }}>
          VS
        </div>

        {/* MARKOV · the boss */}
        <div style={{ flex: 1, maxWidth: 190, display: "flex", flexDirection: "column", alignItems: "center", animation: "slamR 0.45s cubic-bezier(0.22,1.2,0.36,1) both" }}>
          <img src={MARKOV_ART} alt="MARKOV" style={{ width: "min(32vw, 128px)", height: "auto", objectFit: "contain", animation: "idleBob 3.2s ease-in-out infinite", filter: "drop-shadow(0 0 22px rgba(251,191,36,0.35))" }} />
          <div aria-hidden style={{ width: "min(26vw, 100px)", height: 18, borderRadius: "50%", background: `radial-gradient(ellipse, ${AI_GREEN}44 0%, transparent 70%)`, filter: "blur(5px)", marginTop: -6 }} />
          <div style={{ fontFamily: T.display, fontSize: 17, color: "#fff", letterSpacing: "0.03em", textShadow: `0 0 18px ${RIM}66`, marginTop: 6 }}>MARKOV</div>
          <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, fontWeight: 700, marginTop: 3 }}>arena boss · learns patterns</div>
        </div>
      </div>

      {/* match format · one glance, no reading */}
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 18, flexWrap: "wrap" }}>
        {["BEST OF 5", "FIRST TO 3", "STREAMS LIVE"].map((chip) => (
          <span key={chip} style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", color: T.inkDim, background: "rgba(0,0,0,0.4)", border: `1px solid ${T.hairline}`, borderRadius: 999, padding: "5px 11px" }}>{chip}</span>
        ))}
      </div>

      {/* loadout · the ONE pre-match choice, smart default pre-selected. The
          full editor stays behind ⚙️; changing here bundles a signed save into
          the play tap ("SAVE & PLAY"). */}
      {strategy && (
        <div style={{ marginTop: 14, alignSelf: "center", width: "100%", maxWidth: 340 }}>
          <div style={{ fontFamily: T.body, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", color: T.inkSoft, textAlign: "center", marginBottom: 7 }}>
            {name.toUpperCase()}&apos;S GAME PLAN
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
            {STRATEGY_OPTIONS.map((opt) => {
              const on = strategy === opt.id;
              return (
                <button key={opt.id} onClick={busy ? undefined : () => onStrategy(opt.id)} style={{
                  padding: "7px 13px", borderRadius: 999, cursor: busy ? "default" : "pointer",
                  background: on ? CYAN : "rgba(0,0,0,0.4)",
                  border: `1px solid ${on ? CYAN : T.hairline}`,
                  color: on ? "#062c38" : T.inkDim,
                  fontFamily: T.body, fontSize: 11.5, fontWeight: 800,
                  transition: "background 0.15s, color 0.15s",
                }}>{opt.label}</button>
              );
            })}
          </div>
        </div>
      )}

      {capped && (
        <div style={{ marginTop: 12, alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 999, padding: "7px 14px", fontFamily: T.body, fontSize: 11, fontWeight: 700, color: RIM }}>
          🎟 {name} played {agent.matchesToday ?? agent.dailyMatchCap ?? ""}/{agent.dailyMatchCap ?? ""} matches today — cap resets daily
        </div>
      )}

      {err && <div style={{ marginTop: 12, fontFamily: T.body, fontSize: 12, color: "#fca5a5", textAlign: "center" }}>{err}</div>}

      {/* thumb zone · one action */}
      <div
        role="button"
        onClick={busy ? undefined : capped ? onSettings : onPlay}
        style={{ cursor: busy ? "wait" : "pointer", userSelect: "none", borderRadius: 18, background: "#083344", paddingBottom: 6, width: "100%", maxWidth: 340, margin: "16px auto 0", boxShadow: `0 12px 26px -6px ${CYAN}66, inset 0 -3px 8px rgba(0,0,0,0.4)`, transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1)" }}
        onMouseDown={(e) => { if (!busy) (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(3px)"; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
      >
        <div style={{ borderRadius: "16px 16px 12px 12px", minHeight: 60, boxSizing: "border-box", background: busy ? "rgba(34,211,238,0.4)" : `linear-gradient(160deg, #a5f3fc 0%, ${CYAN} 50%, #0e7490 100%)`, padding: "13px 20px 11px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.55), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
          <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: phase === "idle" ? 17 : 14, color: "#062c38", letterSpacing: "0.04em" }}>
            {label}
          </span>
        </div>
      </div>
      <div style={{ marginTop: 9, fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textAlign: "center" }}>
        🔒 provably fair · streams live
      </div>
    </div>
  );
}

function AgentCard({ agent, live, done }: { agent: OwnedAgent; live: boolean; done?: boolean }) {
  const short = `${agent.agentAddress.slice(0, 6)}…${agent.agentAddress.slice(-4)}`;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.4)", border: `1px solid rgba(34,211,238,0.25)`, borderRadius: 16, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
        <img src={AGENT_ART} alt="" style={{ width: 38, height: 38, objectFit: "contain", transform: "scaleX(-1)", filter: `hue-rotate(${agentHue(agent.agentAddress)}deg)` }} />
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: T.body, fontSize: 10.5, fontWeight: 800, color: live ? "#fca5a5" : done ? "#86efac" : T.inkSoft, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: live ? "#ef4444" : done ? "#22c55e" : T.inkSoft, boxShadow: live ? "0 0 8px #ef4444" : "none", animation: live ? "livePulse 1.2s ease-in-out infinite" : "none" }} />
        {live ? "LIVE" : done ? "FINISHED" : "IDLE"}
      </span>
    </div>
  );
}

// ═══ live match viewer ═════════════════════════════════════════════════════════
function LiveMatch({ matchId, watchUrl, agentName, agentAddress, onEnded, onPlayAgain }: { matchId: string; watchUrl: string | null; agentName: string; agentAddress?: string; onEnded?: () => void; onPlayAgain?: () => void }) {
  const [rounds, setRounds] = useState<LiveRound[]>([]);
  const [score, setScore] = useState({ player: 0, ai: 0, ties: 0 });
  const [line, setLine] = useState<string | null>(null);
  const [ended, setEnded] = useState<LiveFinal | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // OUR arena feed is primary: the match runs on our engine, and our feed
    // replays history to late joiners (Samuel's stream doesn't — that's how
    // round 1 went missing from the tape). His watchUrl is the fallback.
    const primary = `${LIVE_BASE}/${matchId}`;
    const fallback = watchUrl;
    let gotFrame = false;
    let usedFallback = false;
    let es: EventSource | null = null;

    const connect = (url: string) => {
      try {
        es = new EventSource(url);
      } catch {
        return;
      }
      es.onopen = () => setConnected(true);
      es.onmessage = onFrame;
      es.onerror = () => {
        setConnected(false);
        if (!gotFrame && fallback && !usedFallback) {
          usedFallback = true;
          es?.close();
          connect(fallback);
        }
      };
    };

    const onFrame = (ev: MessageEvent) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return;
      }
      gotFrame = true; // a valid frame arrived · don't fall back
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
        onEnded?.();
        es?.close();
      }
    };

    connect(primary);
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

      {/* Pre-round-1 · never a dead 0-0 screen: the fighters square up in the
          arena while the agent process boots and throws its first move. This
          fills the same gap the manual match fills with the chant + fists. */}
      {!ended && rounds.length === 0 && (
        <WaitingFaceoff agentName={agentName} agentAddress={agentAddress} connected={connected} />
      )}

      {/* victory/defeat hero rises ABOVE the tape the moment the match ends —
          no scroll-hunting for the result, no dead gap (celebrate, then guide) */}
      {ended && <MatchEnd final={ended} score={score} agentName={agentName} agentAddress={agentAddress} onPlayAgain={onPlayAgain} />}

      {/* round-by-round tape */}
      <div ref={scrollRef} style={{ flex: ended || rounds.length === 0 ? undefined : 1, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 6, minHeight: 0, maxHeight: ended ? 160 : 220 }}>
        {rounds.map((r) => (
          <RoundRow key={r.round} r={r} />
        ))}
      </div>
    </div>
  );
}

// ═══ waiting face-off · the gap before round 1 ════════════════════════════════
// Agent matches have real boot time on GoodAgents (process start + pacing).
// Fill it with the fight, not a spinner: both fighters bob face to face,
// MARKOV runs his mouth, a pulse line says exactly what we're waiting for,
// and past ~25s an honest "warming up" note manages expectations.
const WAITING_LINES = [
  "reading your bot's source code. adorable.",
  "i've already simulated this match. you lose.",
  "your agent is warming up. i don't need to.",
  "booting… or stalling? i'd stall too.",
];

function WaitingFaceoff({ agentName, agentAddress, connected }: { agentName: string; agentAddress?: string; connected: boolean }) {
  const [lineIdx, setLineIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setLineIdx((i) => (i + 1) % WAITING_LINES.length), 4500);
    const s = setTimeout(() => setSlow(true), 25_000);
    return () => { clearInterval(t); clearTimeout(s); };
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "10px 0" }}>
      {/* MARKOV talks while your bot boots */}
      <div
        key={lineIdx}
        style={{ maxWidth: 300, background: "rgba(0,0,0,0.55)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 14, padding: "8px 14px", fontFamily: T.body, fontSize: 12, fontStyle: "italic", color: "rgba(240,230,255,0.92)", textAlign: "center", animation: "bubblePop 0.4s cubic-bezier(0.22,1.4,0.36,1) both", marginBottom: 16 }}
      >
        “{WAITING_LINES[lineIdx]}”
      </div>

      {/* the face-off, alive */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AGENT_ART} alt={agentName} style={{ width: "min(26vw, 108px)", height: "auto", objectFit: "contain", transform: "scaleX(-1)", animation: "idleBobAlt 2.6s ease-in-out infinite", filter: `hue-rotate(${agentHue(agentAddress || "")}deg) drop-shadow(0 0 18px rgba(34,211,238,0.45))` }} />
        <div style={{ fontFamily: T.display, fontSize: 28, color: RIM, textShadow: `0 0 22px ${RIM}`, animation: "vsPop 0.5s cubic-bezier(0.22,1.4,0.36,1) both" }}>VS</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARKOV_ART} alt="MARKOV" style={{ width: "min(28vw, 116px)", height: "auto", objectFit: "contain", animation: "idleBob 3.2s ease-in-out infinite", filter: "drop-shadow(0 0 18px rgba(251,191,36,0.35))" }} />
      </div>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 18, fontFamily: T.body, fontSize: 11.5, color: CYAN_SOFT, fontWeight: 700 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: CYAN, animation: "livePulse 1.2s ease-in-out infinite" }} />
        {connected ? `${agentName} is stepping into the ring — first throw incoming…` : "Connecting to the live feed…"}
      </div>
      {slow && (
        <div style={{ marginTop: 8, fontFamily: T.body, fontSize: 10.5, color: T.inkSoft, fontWeight: 700, textAlign: "center", maxWidth: 300 }}>
          Agent matches can take a moment to boot on GoodAgents — the fight starts the second your bot throws.
        </div>
      )}
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

// ═══ result hero ═════════════════════════════════════════════════════════════
// Celebrate, then guide: victory gets the agent's own colored character +
// confetti + a proper candy CTA; defeat gets MARKOV's gloat, no confetti.
const CONFETTI_BITS = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 61) % 100,
  delay: (i % 8) * 0.22,
  color: ["#fbbf24", "#22d3ee", "#a78bfa", "#22c55e", "#f472b6"][i % 5],
  size: 6 + (i % 3) * 3,
}));

function MatchEnd({ final, score, agentName, agentAddress, onPlayAgain }: { final: LiveFinal; score: { player: number; ai: number; ties: number }; agentName: string; agentAddress?: string; onPlayAgain?: () => void }) {
  const won = score.player > score.ai;
  const tie = score.player === score.ai;
  return (
    <div style={{ position: "relative", marginTop: 12, textAlign: "center", overflow: "hidden", background: won ? "rgba(34,211,238,0.1)" : tie ? "rgba(251,191,36,0.1)" : "rgba(239,68,68,0.08)", border: `1px solid ${won ? "rgba(34,211,238,0.45)" : tie ? "rgba(251,191,36,0.4)" : "rgba(239,68,68,0.35)"}`, borderRadius: 18, padding: "16px 14px 14px", animation: "riseIn 0.35s ease both" }}>
      {/* confetti · victory only */}
      {won && CONFETTI_BITS.map((c, i) => (
        <span key={i} aria-hidden style={{ position: "absolute", top: -12, left: `${c.left}%`, width: c.size, height: c.size, borderRadius: 2, background: c.color, animation: `confettiFall ${2.4 + (i % 3) * 0.5}s linear ${c.delay}s infinite`, opacity: 0.9, pointerEvents: "none" }} />
      ))}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={won || tie ? AGENT_ART : MARKOV_ART}
          alt=""
          style={{ width: 62, height: 62, objectFit: "contain", transform: won || tie ? "scaleX(-1)" : undefined, filter: won || tie ? `hue-rotate(${agentHue(agentAddress || "")}deg) drop-shadow(0 0 14px rgba(34,211,238,0.5))` : "drop-shadow(0 0 14px rgba(251,191,36,0.5))", animation: "idleBob 2.6s ease-in-out infinite" }}
        />
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: T.display, fontSize: 24, color: won ? CYAN_SOFT : tie ? RIM : "#fca5a5", letterSpacing: "0.03em", textShadow: won ? "0 0 20px rgba(34,211,238,0.5)" : undefined }}>
            {won ? `${agentName || "Your agent"} wins! 🏆` : tie ? "Dead even" : "MARKOV takes it"}
          </div>
          <div style={{ fontFamily: T.body, fontSize: 11.5, color: T.inkDim, fontWeight: 700, marginTop: 3 }}>
            Final {score.player}–{score.ai}
            {final.seed ? " · provably fair, seed revealed" : ""}
          </div>
        </div>
      </div>

      {!won && !tie && (
        <div style={{ fontFamily: T.body, fontStyle: "italic", fontSize: 11.5, color: "rgba(240,230,255,0.8)", marginTop: 8 }}>
          “tell your bot to bring a better pattern next time.”
        </div>
      )}

      {onPlayAgain && (
        <div
          role="button"
          onClick={onPlayAgain}
          style={{ cursor: "pointer", userSelect: "none", borderRadius: 16, background: "#083344", paddingBottom: 5, maxWidth: 300, margin: "14px auto 0", boxShadow: `0 10px 22px -6px ${CYAN}66, inset 0 -3px 8px rgba(0,0,0,0.4)`, transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1)" }}
          onMouseDown={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.97) translateY(2px)"; }}
          onMouseUp={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
        >
          <div style={{ borderRadius: "14px 14px 11px 11px", background: `linear-gradient(160deg, #a5f3fc 0%, ${CYAN} 55%, #0e7490 100%)`, padding: "12px 20px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 6px 14px rgba(255,255,255,0.5), inset 0 -3px 8px rgba(0,0,0,0.25)" }}>
            <span style={{ fontFamily: T.display, fontSize: 15, color: "#062c38", letterSpacing: "0.04em" }}>
              {won ? "⚔️ RUN IT BACK" : "⚔️ SEND IN AGAIN"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ settings ═════════════════════════════════════════════════════════════════
// Schema-driven config, rendered natively from GoodAgents' /settings/schema.
// Saving signs one "configuration" message and PATCHes the host. Only the
// fields the host advertises show up, so new options appear automatically.
function SettingsScreen({ agent, signer, onDone }: { agent: OwnedAgent; signer?: string; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [fields, setFields] = useState<AgentSettingField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const owner = agent.ownerWallet || signer || "";

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSchemaCached(), getSettingsCached(owner)]).then(([schema, cur]) => {
      if (cancelled) return;
      const fs = schema.fields || [];
      setFields(fs);
      const init: Record<string, unknown> = {};
      for (const f of fs) init[f.key] = cur.configuration?.[f.key] ?? f.default ?? "";
      setValues(init);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [owner]);

  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!agent.deployId) return;
    setSaving(true);
    setMsg(null);
    const issuedAt = Date.now();
    try {
      const signature = await signMessageAsync({ message: deployMsg("configuration", agent.deployId, issuedAt) });
      const out = await goodAgentsPatchSettings(owner, { ownerWallet: signer || owner, issuedAt, signature, configuration: values });
      if (out.ok) { invalidateSettings(owner); setMsg({ ok: true, text: "Saved" + (out.restarted ? " · agent restarted" : "") }); }
      else setMsg({ text: errText(out.error) });
    } catch (e: unknown) {
      const m = (e as { message?: string })?.message || "";
      setMsg({ text: /reject|denied|cancel/i.test(m) ? "You cancelled the signature." : "Wallet couldn't sign. Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton />;

  if (fields.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", color: T.inkDim, fontFamily: T.body, fontSize: 13, gap: 6 }}>
        <div style={{ fontSize: 34 }}>⚙️</div>
        No settings to configure right now.
      </div>
    );
  }

  // Group the schema's flat field list into named sections (settings-UX rule:
  // 3-4 scannable groups beat a wall of cards). Unknown keys land in "More" so
  // new host fields never disappear. Grammar mirrors /settings: uppercase label
  // OUTSIDE the card, purple surface panel, icon tile per row.
  const SECTIONS: { title: string; icon: string; keys: string[] }[] = [
    { title: "How it plays", icon: "🎮", keys: ["GAME_TYPE", "PLAY_MODE", "MARKOV_STRATEGY", "RPS_SEQUENCE", "RPS_FIXED"] },
    { title: "Pace & limits", icon: "⏱️", keys: ["DAILY_MATCH_CAP", "MAX_MATCHES", "MATCH_INTERVAL_SECONDS", "ROUND_PACE_MS", "ACCEPT_TIMEOUT_SECONDS"] },
    { title: "Spending & safety", icon: "💰", keys: ["WAGER_GS", "AUTO_REFILL", "DAILY_REFILL_CAP_GS", "MAX_REFILLS_PER_DAY", "DAILY_LOSS_CAP_GS"] },
  ];
  const visible = fields.filter((f) => visibleWhen(f, values));
  const grouped = SECTIONS.map((s) => ({ ...s, fields: visible.filter((f) => s.keys.includes(f.key)) }));
  const leftovers = visible.filter((f) => !SECTIONS.some((s) => s.keys.includes(f.key)));
  if (leftovers.length) grouped.push({ title: "More", icon: "⚙️", fields: leftovers, keys: [] });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: T.body, fontSize: 12, color: T.inkDim, fontWeight: 600, lineHeight: 1.5 }}>
        Tune how <span style={{ color: CYAN_SOFT, fontWeight: 800 }}>{agent.displayName || "your agent"}</span> plays. One signature on save.
      </div>

      {grouped.filter((g) => g.fields.length > 0).map((g) => (
        <div key={g.title}>
          <div style={{ padding: "0 4px 8px", fontFamily: T.body, fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", color: T.inkDim, textTransform: "uppercase" }}>
            {g.title}
          </div>
          <div style={{ background: "rgba(40,18,100,0.55)", border: `1px solid ${T.hairline}`, borderRadius: 14, overflow: "hidden" }}>
            {g.fields.map((f, i) => (
              <div key={f.key} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.hairline}` }}>
                <Field field={f} icon={g.icon} value={values[f.key]} onChange={(v) => set(f.key, v)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {msg && (
        <div style={{ fontFamily: T.body, fontSize: 12, fontWeight: 700, color: msg.ok ? "#86efac" : "#fca5a5", textAlign: "center" }}>
          {msg.ok ? "✓ " : ""}{msg.text}
        </div>
      )}

      {/* sticky save bar · always reachable, no scroll hunting */}
      <div style={{ position: "sticky", bottom: 8, display: "flex", gap: 10, marginTop: 4, padding: 8, borderRadius: 18, background: "rgba(10,4,40,0.85)", backdropFilter: "blur(8px)", border: `1px solid ${T.hairline}` }}>
        <button
          onClick={onDone}
          style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hairline}`, color: T.inkDim, borderRadius: 14, padding: "13px", fontFamily: T.display, fontSize: 14, cursor: "pointer" }}
        >
          Done
        </button>
        <button
          onClick={saving ? undefined : save}
          style={{ flex: 2, background: saving ? "rgba(34,211,238,0.4)" : `linear-gradient(160deg, #a5f3fc 0%, ${CYAN} 60%, #0e7490 100%)`, border: "2px solid rgba(255,255,255,0.4)", color: "#062c38", borderRadius: 14, padding: "13px", fontFamily: T.display, fontSize: 14, letterSpacing: "0.03em", cursor: saving ? "wait" : "pointer", boxShadow: `0 10px 22px -6px ${CYAN}66` }}
        >
          {saving ? "SIGNING…" : "💾 SAVE SETTINGS"}
        </button>
      </div>
    </div>
  );
}

// Honor the schema's `when` clause — a field shows only when the named fields
// currently hold the given values (e.g. sequence moves only for the sequence
// strategy). Keeps the form tidy instead of dumping every key at once.
function visibleWhen(field: AgentSettingField, values: Record<string, unknown>): boolean {
  if (!field.when) return true;
  return Object.entries(field.when).every(([k, v]) => String(values[k]) === String(v));
}

// Per-field emoji for the row icon tile (same 34px tile grammar as /settings).
const FIELD_ICONS: Record<string, string> = {
  GAME_TYPE: "🎲", PLAY_MODE: "🕹️", MARKOV_STRATEGY: "🧠", RPS_SEQUENCE: "🔁", RPS_FIXED: "📌",
  DAILY_MATCH_CAP: "🎟️", MAX_MATCHES: "🔢", MATCH_INTERVAL_SECONDS: "⏳", ROUND_PACE_MS: "🐢",
  ACCEPT_TIMEOUT_SECONDS: "⌛", WAGER_GS: "💵", AUTO_REFILL: "🔄", DAILY_REFILL_CAP_GS: "💳",
  MAX_REFILLS_PER_DAY: "🧮", DAILY_LOSS_CAP_GS: "🛡️",
};

// One setting = one compact row inside its section (icon tile + label left,
// control right; enums get a chip row). Same row grammar as /settings.
function Field({ field, icon, value, onChange }: { field: AgentSettingField; icon: string; value: unknown; onChange: (v: unknown) => void }) {
  const tile = (
    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
      {FIELD_ICONS[field.key] || icon}
    </div>
  );
  const label = (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontFamily: T.body, fontSize: 12.5, color: "#fff", fontWeight: 700 }}>{field.label || field.key}</div>
      {field.hint && <div style={{ fontFamily: T.body, fontSize: 10, color: T.inkSoft, marginTop: 1 }}>{field.hint}</div>}
    </div>
  );

  if (field.type === "enum" && field.options) {
    return (
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{tile}{label}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 46 }}>
          {field.options.map((opt) => {
            const on = String(value) === opt;
            return (
              <button key={opt} onClick={() => onChange(opt)} style={{
                padding: "6px 13px", borderRadius: 999, cursor: "pointer",
                background: on ? CYAN : "rgba(255,255,255,0.05)",
                border: `1px solid ${on ? CYAN : T.hairline}`,
                color: on ? "#062c38" : T.inkDim,
                fontFamily: T.body, fontSize: 11.5, fontWeight: 800,
                transition: "background 0.15s, color 0.15s",
              }}>{opt}</button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === "boolean") {
    const on = value === true || value === "true" || value === "1" || value === 1;
    return (
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {tile}
        {label}
        <button onClick={() => onChange(on ? "0" : "1")} style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: on ? CYAN : "rgba(255,255,255,0.15)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
        </button>
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        {tile}
        {label}
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 88, flexShrink: 0, background: "rgba(0,0,0,0.45)", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "8px 10px", color: "#fff", fontFamily: T.body, fontSize: 13, fontWeight: 700, textAlign: "center", outline: "none" }}
        />
      </div>
    );
  }

  // string / fallback · full-width input under the label
  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{tile}{label}</div>
      <input
        type="text"
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{ marginLeft: 46, background: "rgba(0,0,0,0.45)", border: `1px solid ${T.hairline}`, borderRadius: 10, padding: "9px 11px", color: "#fff", fontFamily: T.body, fontSize: 13, outline: "none" }}
      />
    </div>
  );
}
