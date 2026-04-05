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
