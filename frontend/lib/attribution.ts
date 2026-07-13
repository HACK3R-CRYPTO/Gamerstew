import { toDataSuffix } from "@celo/attribution-tags";

// Celo Agentic Payments & DeFAI Hackathon attribution tag, locked to the
// GameArena repo at registration. Appended to every on-chain transaction via
// viem/wagmi's `dataSuffix` so our tagged, on-chain volume is credited on the
// hackathon Dune leaderboard (Most Revenue track). Only the assigned tag is
// credited, and only tagged Celo-mainnet txns during the hackathon window count.
export const ATTRIBUTION_TAG = "celo_8f1153358492";

// Hex suffix (ERC-8021) to pass as `dataSuffix` on writeContract / sendTransaction.
export const ATTRIBUTION_SUFFIX = toDataSuffix(ATTRIBUTION_TAG) as `0x${string}`;
