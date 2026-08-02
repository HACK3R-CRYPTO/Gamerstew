"use client";

import { useEffect, useMemo, useState } from "react";

// One agent a player has deployed via GoodAgents, as returned by the partner
// lookup endpoint. The agent is attached to its owner wallet, mints a GameArena
// GamePass (gamePassUsername), and carries its own live-match state so the lobby
// can jump straight to watching it play.
export type OwnedAgent = {
  deployId: string;
  displayName: string;
  agentAddress: string;
  ownerWallet: string;
  gamePassUsername: string | null;
  status: string | null;
  verified?: boolean;
  readyToPlay?: boolean;
  activeMatchId: string | null;
  livePhase: string | null;
  liveWatchUrl: string | null;
};

const PARTNER_AGENTS_URL =
  "https://goodagentids.xyz/host/partners/gamearena/agents";

// Given the player's wallet(s), returns the agents they deployed. This is the
// owner -> agent lookup: on-chain we can only go agent -> owner, so the lobby
// relies on Samuel's partner endpoint to answer "does this player already have
// an agent?" and to show it instead of asking for anything. Pass every linked
// wallet (embedded + external); results merge across all of them.
export function useOwnedAgents(
  wallets: (string | undefined | null)[],
  // When set, re-fetch on this interval so live match state (activeMatchId,
  // liveWatchUrl, livePhase) stays fresh and the lobby can flip to the live
  // viewer the moment the agent steps into a match. Omit for a one-shot lookup.
  pollMs?: number,
) {
  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          wallets
            .filter(Boolean)
            .map((w) => (w as string).toLowerCase())
            .filter((w) => /^0x[0-9a-f]{40}$/.test(w)),
        ),
      ),
    [wallets],
  );

  const key = owners.join(",");
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (owners.length === 0) {
      setAgents([]);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      Promise.all(
        owners.map((owner) =>
          fetch(`${PARTNER_AGENTS_URL}?owner=${owner}`)
            .then((r) => (r.ok ? r.json() : { agents: [] }))
            .then((d) => (Array.isArray(d?.agents) ? (d.agents as OwnedAgent[]) : []))
            .catch(() => [] as OwnedAgent[]),
        ),
      )
        .then((lists) => {
          if (cancelled) return;
          // Merge and de-dupe by agentAddress across every wallet.
          const byAddress = new Map<string, OwnedAgent>();
          for (const a of lists.flat()) {
            if (a?.agentAddress) byAddress.set(a.agentAddress.toLowerCase(), a);
          }
          setAgents(Array.from(byAddress.values()));
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError("Could not load your agents");
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
          if (pollMs && pollMs > 0) timer = setTimeout(() => load(false), pollMs);
        });
    };

    load(true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs]);

  return { agents, loading, error, hasAgent: agents.length > 0 };
}
