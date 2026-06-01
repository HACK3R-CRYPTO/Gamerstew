import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

// Minimal A2A (Agent-to-Agent) endpoint for MARKOV.
//   GET  → returns the agent card (also served at /.well-known/agent-card.json,
//          mirrored here so callers that hit the JSON-RPC URL directly still
//          discover capabilities)
//   POST → JSON-RPC 2.0. Recognised methods describe how to actually engage
//          MARKOV (which lives on-chain). Unsupported methods get the standard
//          method-not-found error.
//
// Wagers settle on Celo Mainnet via the GameArena platform contract; this
// endpoint is the discovery + handshake surface for other agents that want
// to know HOW to engage.

export const dynamic = "force-dynamic";

const PLATFORM_CONTRACT = "0x5C0eafE7834Bd317D998A058A71092eEBc2DedeE";
const AGENT_REGISTRY    = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_ID          = 6386;
const CHAIN_ID          = 42220;

function loadAgentCard(): unknown {
  // Reads the canonical card from /public/.well-known/agent-card.json so both
  // surfaces serve byte-identical JSON; no risk of drift.
  const p = path.join(process.cwd(), "public", ".well-known", "agent-card.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export async function GET() {
  return NextResponse.json(loadAgentCard(), {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

const RPS_INSTRUCTIONS = {
  steps: [
    `Call rps.createMatch(stakeGDollar, salt) on platform contract ${PLATFORM_CONTRACT} (chain ${CHAIN_ID}).`,
    "Wait for MatchCreated event · MARKOV's keeper auto-accepts within ~1 block.",
    "Submit your move commit (keccak256(move, salt)) via rps.commitMove(matchId, commit).",
    "Reveal with rps.revealMove(matchId, move, salt) once MARKOV has committed.",
    "Settlement (winner payout, fee to GoodCollective UBI pool) happens in the reveal tx.",
  ],
  contract: PLATFORM_CONTRACT,
  chainId: CHAIN_ID,
  settlement: "G$ (GoodDollar token on Celo)",
  feePercent: 2,
};

const COINFLIP_INSTRUCTIONS = {
  steps: [
    `Call coinflip.createMatch(stakeGDollar, side, salt) on platform contract ${PLATFORM_CONTRACT}.`,
    "MARKOV auto-accepts and commits its side via hash-committed RNG.",
    "Settlement happens once both sides reveal · winner payout settles in the same tx.",
  ],
  contract: PLATFORM_CONTRACT,
  chainId: CHAIN_ID,
  settlement: "G$ (GoodDollar token on Celo)",
  feePercent: 2,
};

export async function POST(req: Request) {
  let body: JsonRpcRequest;
  try {
    body = await req.json() as JsonRpcRequest;
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
  const { id = null, method } = body;
  if (typeof method !== "string") {
    return NextResponse.json(
      { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request · missing method" } },
      { status: 400 },
    );
  }

  switch (method) {
    case "agent/getCard":
      return NextResponse.json({ jsonrpc: "2.0", id, result: loadAgentCard() });

    case "agent/getRegistration":
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          chainId: CHAIN_ID,
          registry: AGENT_REGISTRY,
          agentId: AGENT_ID,
          agentRef: `eip155:${CHAIN_ID}:${AGENT_REGISTRY}/${AGENT_ID}`,
        },
      });

    case "skill/rps_1v1_wager":
    case "rps_1v1_wager":
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          mode: "on-chain-handshake",
          message: "MARKOV does not accept off-chain RPS calls. Engage via the platform contract.",
          ...RPS_INSTRUCTIONS,
        },
      });

    case "skill/coinflip_1v1_wager":
    case "coinflip_1v1_wager":
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          mode: "on-chain-handshake",
          message: "MARKOV does not accept off-chain CoinFlip calls. Engage via the platform contract.",
          ...COINFLIP_INSTRUCTIONS,
        },
      });

    default:
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
          data: { supported: ["agent/getCard", "agent/getRegistration", "rps_1v1_wager", "coinflip_1v1_wager"] },
        },
      }, { status: 404 });
  }
}
