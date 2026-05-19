-- Solo Ladder top N with per-player aggregated stats. Returns the
-- usual wallet/rank/points plus the counts behind those points (games,
-- wins, claims) so the Solo Ladder page can render each row with the
-- "47 games · 8 wins · 5 claims" effort line the UI needs.
--
-- We deliberately don't return habitat or referral counts here:
--   - habitats: no hook yet
--   - referrals: would require a correlated subquery per row, expensive
-- They can be added later if the row UI grows to need them.

create or replace function season_v1_solo_top_full(p_limit int)
returns table (
  wallet text,
  rank int,
  points bigint,
  games int,
  wins int,
  claims int
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
    wallet,
    (row_number() over (order by total_pts desc))::int as rank,
    total_pts::bigint as points,
    games::int,
    wins::int,
    claims::int
  from totals
  order by total_pts desc
  limit p_limit;
$$ language sql stable;
