-- 2026-11-24 · A score on the chain is always saved. Run once in the Supabase
-- SQL editor. Safe to run again.
--
-- After a score is written to the chain, the run still has to be saved: the
-- board row, XP, missions, achievements. That step depended on one more call
-- from the player's phone. When that call failed, or the tab was closed, the
-- score was on the chain and nothing else was recorded. One such run is known.
--
-- These two columns let the server finish the job itself:
--   tx_hash   the transaction that recorded the run
--   saved_at  when the run was saved (empty = not yet)
-- A job looks for runs with a transaction and no save, and saves them.

alter table game_sessions add column if not exists tx_hash  text;
alter table game_sessions add column if not exists saved_at timestamptz;

-- Runs from before today are treated as already dealt with, so the job does
-- not go back through history and award old runs a second time.
update game_sessions set saved_at = coalesce(used_at, created_at)
where saved_at is null and used and coalesce(used_at, created_at) < timestamptz '2026-11-24 00:00:00+00';

-- the job's query: used, has a transaction, not saved
create index if not exists game_sessions_unsaved_idx on game_sessions (used_at) where used and tx_hash is not null and saved_at is null;

-- The one run known to be lost: a Word Ladder score of 58 that reached the chain
-- on 2026-11-24 09:05 UTC and was never saved. Giving it its transaction lets
-- the job save it (board link, XP, missions) within a few minutes.
update game_sessions
set tx_hash = '0x15337dfc983975b1f3a0769b2b6af5905677973395f783bb4e2ae63f15b621e7', saved_at = null
where lower(wallet) = '0xa479b8c6030cbb01f8e9f6acb2ad2c757c81894d' and game = 'ladder' and computed_score = 58 and used
  and used_at >= timestamptz '2026-11-24 08:55:00+00' and used_at <= timestamptz '2026-11-24 09:15:00+00';
