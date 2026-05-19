-- Solo Ladder top N with per-player aggregated stats + username for the
-- avatar/identity seed (mirrors how /leaderboard joins the users table).
-- Username is nullable; the UI falls back to a shortened wallet when
-- the player hasn't set one.

create or replace function season_v1_solo_top_full(p_limit int)
returns table (
  wallet   text,
  username text,
  rank     int,
  points   bigint,
  games    int,
  wins     int,
  claims   int
) as $$
  with meta as (
    select starts_at, ends_at
    from season_v1_meta
    where active = true
    limit 1
  ),
  ledger as (
    select pp.wallet, pp.action_type, pp.points
    from season_v1_points pp, meta m
    where pp.occurred_at >= m.starts_at
      and pp.occurred_at <= m.ends_at
  ),
  totals as (
    select
      wallet,
      sum(points) as total_pts,
      count(*) filter (where action_type = 'game_played') as games,
      count(*) filter (where action_type = 'wager_won')   as wins,
      count(*) filter (where action_type = 'daily_claim') as claims
    from ledger
    group by wallet
  )
  select
    t.wallet,
    u.username,
    (row_number() over (order by t.total_pts desc))::int as rank,
    t.total_pts::bigint as points,
    t.games::int,
    t.wins::int,
    t.claims::int
  from totals t
  left join users u on lower(u.wallet_address) = lower(t.wallet)
  order by t.total_pts desc
  limit p_limit;
$$ language sql stable;
