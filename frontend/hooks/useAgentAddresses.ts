"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { AGENT_VAULT_ADDRESS } from "@goodagent/widget";

const ZERO = "0x0000000000000000000000000000000000000000";

// getAgent lives on the vault contract (AGENT_VAULT_ADDRESS = 0x0409042B...),
// NOT on AGENT_ATTESTATION_ADDRESS despite the name — verified on-chain: the
// attestation address reverts on getAgent. Using the vault is what actually
// returns the agent's operator.
const ATTESTATION = AGENT_VAULT_ADDRESS;

// Minimal ABI for the one call we need. The package exports the attestation
// contract address but not its ABI, so we declare the getAgent fragment here.
// getAgent(address) returns (operator, stakeAmount, unlockAt) · a non-zero
// operator means the address is a registered agent.
const GET_AGENT_ABI = [
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "operator", type: "address" },
      { name: "stakeAmount", type: "uint256" },
      { name: "unlockAt", type: "uint256" },
    ],
  },
] as const;

// Given a list of wallet addresses, returns a lowercased Map of the ones that
// are deployed GoodAgents agents → their operator (the owner wallet). Source of
// truth is on-chain: getAgent(address) returns a non-zero operator for a real
// agent (and the zero address for a normal human wallet). One multicall covers
// every address passed in, so a whole leaderboard costs a single RPC round-trip.
// This is what lets the board attach each agent to the player who deployed it.
export function useAgentOperators(wallets: (string | undefined | null)[]): Map<string, string> {
  const unique = useMemo(
    () => Array.from(new Set(wallets.filter(Boolean).map((w) => (w as string).toLowerCase()))),
    [wallets],
  );

  const { data } = useReadContracts({
    contracts: unique.map((w) => ({
      address: ATTESTATION as `0x${string}`,
      abi: GET_AGENT_ABI,
      functionName: "getAgent" as const,
      args: [w as `0x${string}`],
    })),
    query: { enabled: unique.length > 0, staleTime: 5 * 60_000 },
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    data.forEach((res, i) => {
      const r = res.result as unknown;
      // getAgent returns { operator, stakeAmount, unlockAt }. viem may hand it
      // back as an object or a positional tuple; handle both.
      const operator = Array.isArray(r)
        ? (r[0] as string | undefined)
        : (r as { operator?: string } | undefined)?.operator;
      if (operator && operator.toLowerCase() !== ZERO) map.set(unique[i], operator.toLowerCase());
    });
    return map;
  }, [data, unique]);
}

// Convenience: just the set of agent addresses (used where the owner isn't
// needed, e.g. badging the all-time board).
export function useAgentAddresses(wallets: (string | undefined | null)[]): Set<string> {
  const operators = useAgentOperators(wallets);
  return useMemo(() => new Set(operators.keys()), [operators]);
}
