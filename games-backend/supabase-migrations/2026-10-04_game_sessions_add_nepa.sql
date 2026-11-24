-- Add "NEPA: Up Light" (gameType 4) to the game_sessions machinery.
--
-- Two additive changes, same pattern as 2026-06-22_game_sessions_add_stack.sql:
--
--   1. Widen the game check constraint to allow 'nepa'. Without this,
--      /api/start-game for nepa fails with 500 "Failed to start session"
--      (the insert violates the ('rhythm','simon','stack') check) — exactly
--      the bug Stack hit when it launched.
--
--   2. Add a nullable `seed` column. NEPA is seed-driven: /api/start-game
--      generates a per-session seed and stores it here so the client can't
--      choose a favourable light-cut schedule. /api/sign-score reads it back
--      to replay the run (shadow-mode anti-cheat). Nullable so every existing
--      game's rows (which never set it) stay valid.
--
-- Pattern for any future game: append to the IN list + reuse the column.

alter table game_sessions
  drop constraint if exists game_sessions_game_check;

alter table game_sessions
  add constraint game_sessions_game_check
  check (game in ('rhythm', 'simon', 'stack', 'nepa'));

alter table game_sessions
  add column if not exists seed text;
