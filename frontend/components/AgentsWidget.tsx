"use client";

import { GoodAgentWidget, createGameArenaWidgetConfig, usePrivyWalletAdapter } from "@goodagent/widget";
import "@goodagent/widget/styles.css";

// The GoodAgents widget + the Privy wallet bridge, isolated in its own client
// component so the page can load it with dynamic ssr:false. Keeping it
// client-only avoids the widget touching browser APIs during server prerender.
export default function AgentsWidget() {
  // preferExternal uses a connected external wallet when there is one, else the
  // app's embedded Privy wallet.
  const wallet = usePrivyWalletAdapter({ preferExternal: true });

  return (
    <GoodAgentWidget
      mode="full"
      wallet={wallet}
      config={createGameArenaWidgetConfig({
        partnerId: "gamearena",
        fvCallbackUrl: "https://gamearenahq.xyz/agents",
      })}
    />
  );
}
