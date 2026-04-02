#!/usr/bin/env bash
# Register Markov-1 on the official ERC-8004 Identity Registry (Celo Mainnet)
# Usage: bash register-agent.sh --account <your-cast-wallet-name>

set -e

REGISTRY="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
RPC="https://forno.celo.org"
AGENT_WALLET="0x2E33d7D5Fa3eD4Dd6BEb95CdC41F51635C4b7Ad1"

# Encode metadata as a base64 data URI (no IPFS needed)
METADATA=$(cat agent-metadata.json)
ENCODED=$(echo -n "$METADATA" | base64)
AGENT_URI="data:application/json;base64,$ENCODED"

echo "📋 Registering Markov-1 on ERC-8004 registry..."
echo "   Registry: $REGISTRY"
echo "   URI length: ${#AGENT_URI} chars"
echo ""

# Step 1: Register — get back the agentId
ACCOUNT="${1:-deployer}"

echo "▶ Step 1: register(agentURI)"
AGENT_ID=$(cast send "$REGISTRY" \
  "register(string)(uint256)" \
  "$AGENT_URI" \
  --rpc-url "$RPC" \
  --account "$ACCOUNT" \
  --json | jq -r '.logs[0].topics[1]' | cast to-dec)

echo "✅ Registered! agentId = $AGENT_ID"
echo ""

# Step 2: Link the AI agent wallet to the token
echo "▶ Step 2: setAgentWallet($AGENT_ID, $AGENT_WALLET)"
cast send "$REGISTRY" \
  "setAgentWallet(uint256,address)" \
  "$AGENT_ID" \
  "$AGENT_WALLET" \
  --rpc-url "$RPC" \
  --account "$ACCOUNT"

echo ""
echo "✅ Done! Markov-1 is now registered on ERC-8004."
echo ""
echo "👉 Add this to frontend/.env:"
echo "   VITE_AGENT_TOKEN_ID=$AGENT_ID"
