-- 2026-11-24 · Friend rooms survive a restart. Run once in the Supabase SQL
-- editor. Safe to run again.
--
-- A room lives in the server's memory while it is played. Every deploy restarts
-- the server, which used to end every open room. Each room is now also written
-- here (who is in it, the round, the scores) and read back when the server
-- starts. A room is small, there are at most a couple of thousand, and a row is
-- deleted when its room closes or goes quiet for 20 minutes.

create table if not exists friend_rooms (
  code       text primary key,
  game       text        not null,
  data       jsonb       not null,
  touched_at timestamptz not null default now()
);
create index if not exists friend_rooms_touched_idx on friend_rooms (touched_at);

-- Only the server reads or writes this table: the rows hold each player's
-- private seat key.
alter table friend_rooms enable row level security;
