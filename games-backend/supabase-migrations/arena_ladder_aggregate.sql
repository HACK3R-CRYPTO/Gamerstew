-- Challenge-AI (MARKOV) ladder · database-side aggregation
-- ------------------------------------------------------------------
-- The ladder ranks players by summed match points within a week. Reading the
-- raw matches into the app and summing there does not scale: a single agent
-- can grind thousands of matches a season, and PostgREST caps a response at
-- 1000 rows, so an app-side read silently drops players off the board once
-- weekly volume passes that cap.
--
-- Instead, aggregate in Postgres. GROUP BY returns ONE row per wallet — a set
-- bounded by the player count, never the match count — so the result is small,
-- fast (index scan), and can never be truncated by the row cap.

-- Index so the per-week GROUP BY is an index scan even at millions of rows.
create index if not exists arena_free_matches_week_key_idx
  on arena_free_matches (week_key);

-- One row per wallet for the given week, best-first. bigint counts arrive as
-- strings over the REST wire; the app coerces them with Number().
create or replace function arena_ladder_standings(p_week text)
returns table (wallet text, points bigint, matches bigint, wins bigint)
language sql
stable
as $$
  select
    wallet,
    coalesce(sum(points), 0)::bigint                                as points,
    count(*)::bigint                                                as matches,
    count(*) filter (where outcome = 'player_won')::bigint          as wins
  from arena_free_matches
  where week_key = p_week
  group by wallet
  order by points desc, wins desc
$$;
