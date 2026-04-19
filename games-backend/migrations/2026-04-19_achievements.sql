-- Phase 4 (off-chain): Achievements unlocked per player
-- When we deploy WinnerBadge later, the `nft_token_id` and `tx_hash` columns
-- get populated to link the off-chain unlock to the on-chain NFT mint.

CREATE TABLE IF NOT EXISTS achievements_unlocked (
  id              BIGSERIAL PRIMARY KEY,
  wallet          TEXT NOT NULL,
  achievement_id  TEXT NOT NULL,                 -- e.g. 'first_win', 'rhythm_500'
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_score   INTEGER,                       -- score that triggered the unlock (for context)
  trigger_game    TEXT,                          -- 'rhythm' | 'simon'
  -- For Path A (NFT minting) when we add it later
  nft_token_id    BIGINT,
  tx_hash         TEXT,
  UNIQUE (wallet, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_wallet ON achievements_unlocked (wallet);
