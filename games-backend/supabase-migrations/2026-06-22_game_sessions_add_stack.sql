-- Allow 'stack' as a valid game in the game_sessions check constraint.
--
-- Bug: /api/start-game for Stack Tower returned 500 "Failed to start session"
-- because the original constraint was hardcoded to ('rhythm', 'simon'). The
-- backend's VALID_GAMES enum already includes 'stack', but the insert
-- violated this check and bubbled up as an unrecoverable error.
--
-- Pattern: drop the auto-named inline check, re-add a wider one. Same
-- approach to use when adding any future game (just append to the IN list).

alter table game_sessions
  drop constraint if exists game_sessions_game_check;

alter table game_sessions
  add constraint game_sessions_game_check
  check (game in ('rhythm', 'simon', 'stack'));
