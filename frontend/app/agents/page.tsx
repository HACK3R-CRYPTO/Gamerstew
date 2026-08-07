"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";
import { useOwnedAgents } from "@/hooks/useOwnedAgents";
import { agentHue } from "@/components/AgentArena";

// Load the GoodAgents widget client-only. It talks to Privy + goodagentids.xyz
// and touches browser APIs, so it must not run during server prerender.
const AgentsWidget = dynamic(() => import("@/components/AgentsWidget"), {
  ssr: false,
  loading: () => (
    <div style={{ textAlign: "center", padding: 40, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: "rgba(220,210,255,0.7)", fontSize: 13 }}>
      Loading agent studio…
    </div>
  ),
});

// ─── /agents ────────────────────────────────────────────────────────────────
// GoodAgents partnership surface. Players deploy their own AI agent here, verify
// it through GoodDollar (face scan + G$ bond), and monitor it, all inside the
// embedded GoodAgent widget. The agent then plays MARKOV on GoodAgent's servers.
// We are just the host page: the widget (partnerId "gamearena") talks to
// goodagentids.xyz, and the fvCallbackUrl brings the GoodDollar verification
// flow back to this page.
const T = {
  bg: "linear-gradient(180deg, #2a0d6e 0%, #1a0552 40%, #0a0226 100%)",
  ink: "#ffffff",
  inkDim: "rgba(220,210,255,0.7)",
  display: '"Melon Pop", "Fredoka", system-ui, sans-serif',
  body: 'ui-sans-serif, system-ui, -apple-system, "SF Pro Text", sans-serif',
};

export default function AgentsPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // The deploy widget is the EMPTY state. A player who already owns an agent
  // gets their agent home instead: identity, status, and the two actions that
  // matter (send it in, tune it). One agent per wallet (partner API rule).
  const { agents, knowsNoAgent } = useOwnedAgents(address ? [address] : []);
  const agent = agents[0] ?? null;
  const capped = !!agent?.dailyCapReached;
  const hasAgent = !!agent;
  const needsVerify = !!agent && agent.verified === false;
  const heroTitle = needsVerify ? `${agent!.displayName || "Your agent"} needs verification` : hasAgent ? `${agent!.displayName || "Your agent"} is ready` : "Deploy your agent";
  const heroSub = needsVerify
    ? "One GoodDollar face check and your agent can enter the arena. Use the Verify tab below."
    : hasAgent
    ? "Your agent is deployed and attached to your wallet. Send it into the arena, watch it fight MARKOV live, and tune its game plan anytime."
    : "Build a verified AI agent that plays the arena for you. Deploy it, verify it with GoodDollar, and watch it challenge MARKOV. Powered by GoodAgents.";

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, paddingBottom: 96 }}>
      <AppHeader />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "10px 16px 24px" }}>
        <div style={{ textAlign: "center", padding: "6px 0 16px" }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>🤖</div>
          <h1 style={{ fontFamily: T.display, fontSize: 26, color: T.ink, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
            {heroTitle}
          </h1>
          <p style={{ fontFamily: T.body, fontSize: 13.5, color: T.inkDim, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 380 }}>
            {heroSub}
          </p>
        </div>

        {!hasAgent && !knowsNoAgent && address ? (
          <div style={{ textAlign: "center", padding: 40, fontFamily: T.body, color: T.inkDim, fontSize: 13 }}>
            Checking for your agent…
          </div>
        ) : hasAgent && !needsVerify ? (
          <div style={{ maxWidth: 480, margin: "0 auto", borderRadius: 20, background: "rgba(40,18,100,0.55)", border: "1px solid rgba(255,255,255,0.08)", padding: "22px 18px", textAlign: "center" }}>
            {/* the agent, in its colors */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/games/challenge-ai-v2/ai-bot-easy.png" alt={agent.displayName} style={{ width: 110, height: "auto", objectFit: "contain", transform: "scaleX(-1)", animation: "idleBob 3s ease-in-out infinite", filter: `hue-rotate(${agentHue(agent.agentAddress)}deg) drop-shadow(0 0 20px rgba(34,211,238,0.4))` }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
              <span style={{ fontFamily: T.display, fontSize: 22, color: T.ink }}>{agent.displayName || "Your agent"}</span>
              {agent.verified !== false && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: "#67e8f9", background: "rgba(34,211,238,0.14)", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 999, padding: "3px 8px", letterSpacing: "0.08em", fontFamily: T.body }}>VERIFIED</span>
              )}
            </div>
            <div style={{ fontFamily: T.body, fontSize: 11.5, color: "rgba(220,210,255,0.45)", fontWeight: 700, marginTop: 4 }}>
              {agent.gamePassUsername ? `@${agent.gamePassUsername} · ` : ""}{agent.agentAddress.slice(0, 6)}…{agent.agentAddress.slice(-4)}
            </div>
            {typeof agent.matchesToday === "number" && typeof agent.dailyMatchCap === "number" && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontFamily: T.body, fontSize: 10.5, fontWeight: 800, color: capped ? "#fbbf24" : T.inkDim, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "5px 12px" }}>
                🎟 {agent.matchesToday}/{agent.dailyMatchCap} matches today{capped ? " · cap reached, resets daily" : ""}
              </div>
            )}

            <div
              role="button"
              onClick={() => router.push("/games/challenge-ai")}
              style={{ cursor: "pointer", userSelect: "none", borderRadius: 18, background: "#083344", paddingBottom: 6, maxWidth: 320, margin: "18px auto 0", boxShadow: "0 12px 26px -6px rgba(34,211,238,0.6), inset 0 -3px 8px rgba(0,0,0,0.4)" }}
            >
              <div style={{ borderRadius: "16px 16px 12px 12px", minHeight: 60, boxSizing: "border-box", background: "linear-gradient(160deg, #a5f3fc 0%, #22d3ee 55%, #0e7490 100%)", padding: "13px 20px 11px", position: "relative", overflow: "hidden", border: "2px solid rgba(255,255,255,0.4)", boxShadow: "inset 0 8px 18px rgba(255,255,255,0.55), inset 0 -4px 10px rgba(0,0,0,0.25)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", top: 2, left: "4%", right: "4%", height: "48%", background: "linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)", borderRadius: "14px 14px 60px 60px", pointerEvents: "none" }} />
                <span style={{ position: "relative", zIndex: 1, fontFamily: T.display, fontSize: 17, color: "#062c38", letterSpacing: "0.04em" }}>⚔️ SEND IT INTO THE ARENA</span>
                <span style={{ position: "relative", zIndex: 1, fontFamily: T.body, fontSize: 10, color: "#083344", fontWeight: 800, letterSpacing: "0.06em", marginTop: 2, opacity: 0.85 }}>IT FIGHTS MARKOV · YOU WATCH LIVE</span>
              </div>
            </div>
            <div style={{ marginTop: 10, fontFamily: T.body, fontSize: 11, color: "rgba(220,210,255,0.45)", fontWeight: 700 }}>
              Game plan &amp; settings live in the arena lobby · one agent per wallet
            </div>
          </div>
        ) : (
          <AgentsWidget />
        )}
      </div>

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
