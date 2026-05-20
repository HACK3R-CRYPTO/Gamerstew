-- v2 of season_v1_counted_games. Two changes from the original:
--   1. Counts completed games (season_v1_points, action_type='game_played')
--      instead of raw session starts. The points ledger only records games
--      that passed the 8s duration gate inside /api/sign-score, so it's
--      the canonical "real play" count. Avoids inflating team totals from
--      double-fires or abandoned sessions.
--   2. Returns every team-joined player with a `qualified` flag rather
--      than filtering at >= p_min. Lets the leaderboard show team progress
--      from game 1 instead of hiding everything until someone hits 40.
--
-- Same param signature so the existing /api/season/leaderboard call site
-- works without touching the params. Drop first because the return type
-- changed (added the qualified column).

drop function if exists season_v1_counted_games(timestamptz, timestamptz, int, int);

create or replace function season_v1_counted_games(
  p_start timestamptz,
  p_end   timestamptz,
  p_min   int,
  p_max   int
) returns table (team text, wallet text, counted int, qualified boolean) as $$
  with raw_counts as (
    select
      sp.team,
      sp.wallet,
      coalesce(count(pp.id)::int, 0) as raw_games
    from season_v1_players sp
    left join season_v1_points pp
      on  lower(pp.wallet) = lower(sp.wallet)
      and pp.action_type   = 'game_played'
      and pp.occurred_at  >= p_start
      and pp.occurred_at  <= p_end
    group by sp.team, sp.wallet
  )
  select
    rc.team,
    rc.wallet,
    least(rc.raw_games, p_max)::int as counted,
    (rc.raw_games >= p_min)         as qualified
  from raw_counts rc;
$$ language sql stable;
