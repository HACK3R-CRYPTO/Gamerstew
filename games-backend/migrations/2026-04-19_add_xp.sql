-- Phase 2: Add XP column to users table
-- Run this once in the Supabase SQL editor.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;

-- Optional index in case we want to sort users by XP for an "experience leaderboard" later
CREATE INDEX IF NOT EXISTS idx_users_xp ON users (xp DESC);
