-- Hash-committed randomness for the AI agent. At acceptMatch time the
-- agent generates a 32-byte seed and writes `keccak256(seed)` (the
-- commit_hash) to the row BEFORE the player plays. The seed itself is
-- revealed at resolveMatch time. With the seed in hand the player can
-- replay the agent's RNG stream and verify two things:
--   1. The committed hash equals keccak256(seed) — the agent did not
--      substitute a different seed after seeing the player's move.
--   2. The agent's actual on-chain move and the coin-flip oracle outcome
--      both match what the seed deterministically produces when fed
--      through OpponentModel.predict / determineWinner.
-- This is the standard provably-fair gambling pattern, off chain for
-- now (would need contract changes to enforce on chain).

alter table agent_match_state
  add column if not exists commit_hash text,   -- keccak256(seed), known at accept time
  add column if not exists seed        text;   -- 0x-prefixed 32 bytes, revealed at resolve time
