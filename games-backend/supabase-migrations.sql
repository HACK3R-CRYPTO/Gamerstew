-- Run this in your Supabase SQL editor

-- Dice rolls cache: one roll per match, prevents cherry-picking
create table if not exists dice_rolls (
  match_id   bigint primary key,
  roll       smallint not null check (roll >= 1 and roll <= 6),
  created_at timestamp with time zone default now()
);

-- ── Hacked score cleanup ──────────────────────────────────────────────────────
-- Removes scores >= 9990 from both scores and activity tables.
-- Hacked entries seen: 9999, 9998, 9993 (ogazboiz, asdfasdf, Minimie usernames).
-- Run this once in the Supabase SQL editor to clean the live leaderboard.

delete from scores   where score >= 9990;
delete from activity where score >= 9990;

-- Verify nothing hacked remains:
-- select * from scores where score >= 9990;
-- select * from activity where score >= 9990;


-- ── Challenge winners — immutable snapshot per hosted challenge ───────────────
-- Every hosted short-burst challenge (e.g. the 72-hr Arena Cup) freezes its
-- final ranking into this table the first time /api/challenge is read after
-- the event ends. One row per event. Idempotent: upsert on the deterministic
-- id so multiple readers during the end boundary produce exactly one row.
--
-- winners is a JSON array: [{ rank, wallet, username, plays }]
create table if not exists challenge_winners (
  id          text primary key,
  name        text not null,
  starts_at   timestamp with time zone not null,
  ends_at     timestamp with time zone not null,
  min_plays   integer not null,
  top_n       integer not null,
  prize_usdc  integer not null,
  winners     jsonb not null,
  frozen_at   timestamp with time zone not null default now()
);
create index if not exists challenge_winners_ends_at_idx
  on challenge_winners (ends_at desc);

-- ── Activity index — speeds up the challenge windowed scan ────────────────────
create index if not exists activity_created_at_idx on activity (created_at);
