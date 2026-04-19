-- Phase 3: Daily Missions table
-- Run this once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS daily_missions (
  id           BIGSERIAL PRIMARY KEY,
  wallet       TEXT NOT NULL,
  date         DATE NOT NULL,             -- YYYY-MM-DD (UTC) the mission belongs to
  mission_id   TEXT NOT NULL,             -- template id e.g. "play_3_games"
  target       INTEGER NOT NULL,          -- numeric goal (e.g. 3)
  progress     INTEGER NOT NULL DEFAULT 0,
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  claimed      BOOLEAN NOT NULL DEFAULT FALSE,
  reward_xp    INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (wallet, date, mission_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_missions_wallet_date
  ON daily_missions (wallet, date);
