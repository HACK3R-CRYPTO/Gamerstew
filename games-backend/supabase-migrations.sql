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

-- Composite index used by the challenge_leaderboard RPC. Combined with the
-- RPC's predicate (created_at range + GROUP BY wallet_address), this turns a
-- full table scan into an indexed range scan with in-place aggregation.
create index if not exists activity_created_at_wallet_idx
  on activity (created_at, wallet_address);

-- ── challenge_leaderboard(start, end, min_plays, top_n) ─────────────────────
-- Aggregates the activity table inside Postgres and returns one JSON object:
--   {
--     "rankings":  [ { wallet, plays, qualified } ]   // top_n ranked players
--     "plays_map": { wallet: plays, ... }             // all wallets in window
--   }
--
-- Why a function instead of querying the table directly from the app:
--   * GROUP BY + COUNT runs against the index, no row data crosses the wire.
--   * Returns ≤ top_n rows + one map regardless of activity volume.
--   * Single round-trip vs. paginating thousands of rows.
--
-- Re-run safely: CREATE OR REPLACE means deploying never breaks anything,
-- the app's RPC caller falls back to JS aggregation if this isn't deployed.
create or replace function challenge_leaderboard(
  p_start     timestamptz,
  p_end       timestamptz,
  p_min_plays integer,
  p_top_n     integer
) returns json
language sql
stable
as $$
  with counts as (
    select lower(wallet_address) as wallet, count(*)::int as plays
    from activity
    where created_at >= p_start
      and created_at <  p_end
      and wallet_address is not null
    group by lower(wallet_address)
  ),
  top as (
    select wallet, plays, plays >= p_min_plays as qualified
    from counts
    order by plays desc
    limit greatest(p_top_n, 0)
  )
  select json_build_object(
    'rankings',
    coalesce((select json_agg(t) from top t), '[]'::json),
    'plays_map',
    coalesce((select json_object_agg(c.wallet, c.plays) from counts c), '{}'::json)
  );
$$;
