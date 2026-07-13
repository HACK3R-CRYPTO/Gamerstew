// Celo Agentic Payments & DeFAI hackathon attribution tag (celo_8f1153358492),
// encoded as an ERC-8021 data suffix. Hardcoded as a constant to avoid adding a
// runtime dependency to the live agent; this is exactly the value returned by
// toDataSuffix("celo_8f1153358492") from @celo/attribution-tags.
//
// Appended via viem's `dataSuffix` to MARKOV's on-chain transactions (A2A match
// settlements + ERC-8004 feedback attestations) so the agent's real on-chain
// volume is credited on the hackathon leaderboard. Only the assigned tag counts.
export const ATTRIBUTION_SUFFIX =
  "0x63656c6f5f386631313533333538343932110080218021802180218021802180218021" as `0x${string}`;
