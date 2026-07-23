"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AppHeader from "@/components/AppHeader";
import AppBottomNav from "@/components/AppBottomNav";

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
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 900);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div style={{ minHeight: "100dvh", background: T.bg, paddingBottom: 96 }}>
      <AppHeader />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "10px 16px 24px" }}>
        <div style={{ textAlign: "center", padding: "6px 0 16px" }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>🤖</div>
          <h1 style={{ fontFamily: T.display, fontSize: 26, color: T.ink, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
            Deploy your agent
          </h1>
          <p style={{ fontFamily: T.body, fontSize: 13.5, color: T.inkDim, lineHeight: 1.5, margin: "8px auto 0", maxWidth: 380 }}>
            Build a verified AI agent that plays the arena for you. Deploy it, verify it
            with GoodDollar, and watch it challenge MARKOV. Powered by GoodAgents.
          </p>
        </div>

        <AgentsWidget />
      </div>

      <AppBottomNav wide={isDesktop} />
    </div>
  );
}
