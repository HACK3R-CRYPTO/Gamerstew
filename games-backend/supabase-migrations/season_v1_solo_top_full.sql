-- Solo Ladder top N with per-player aggregated stats + username for the
-- avatar/identity seed (mirrors how /leaderboard joins the users table).
-- Username is nullable; the UI falls back to a shortened wallet when
-- the player hasn't set one.
--
-- Also counts qualified referees per wallet — same logic as
-- season_v1_referral_credit, just rolled into the top-N query so the
-- leaderboard can show "X refs" per row + factor refs × 100 into the
-- total points (capped at 10 refs / +1000 pts so sybil farming doesn't
-- dominate). Without this, the formula chip on the page advertises
-- "refs × 100" but no row's score ever reflects them.

create or replace function season_v1_solo_top_full(p_limit int)
returns table (
  wallet   text,
  username text,
  rank     int,
  points   bigint,
  games    int,
  wins     int,
  claims   int,
  refs     int
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
  ledger_totals as (
    select
      wallet,
      sum(points) as ledger_pts,
      count(*) filter (where action_type = 'game_played') as games,
      count(*) filter (where action_type = 'wager_won')   as wins,
      count(*) filter (where action_type = 'daily_claim') as claims
    from ledger
    group by wallet
  ),
  -- Per-wallet count of referees who hit the 40-game qualifier inside
  -- the active season window. Capped at 10 so the bonus stops at +1000.
  referrals as (
    select
      lower(sp.referrer_wallet) as wallet,
      least(count(*), 10)::int  as refs
    from season_v1_players sp, meta m
    where sp.referrer_wallet is not null
      and (
        select count(*) from game_sessions gs
        where lower(gs.wallet) = lower(sp.wallet)
          and gs.started_at >= m.starts_at
          and gs.started_at <= m.ends_at
      ) >= 40
    group by lower(sp.referrer_wallet)
  ),
  -- Combine ledger totals with referral pts. A player can have ledger
  -- pts but no refs (or vice versa), so we full-join via union of keys.
  combined as (
    select
      coalesce(lt.wallet, r.wallet)                                as wallet,
      coalesce(lt.ledger_pts, 0) + (coalesce(r.refs, 0) * 100)     as total_pts,
      coalesce(lt.games, 0)                                        as games,
      coalesce(lt.wins, 0)                                         as wins,
      coalesce(lt.claims, 0)                                       as claims,
      coalesce(r.refs, 0)                                          as refs
    from ledger_totals lt
    full outer join referrals r on lower(lt.wallet) = r.wallet
  )
  select
    c.wallet,
    u.username,
    (row_number() over (order by c.total_pts desc))::int as rank,
    c.total_pts::bigint as points,
    c.games::int,
    c.wins::int,
    c.claims::int,
    c.refs::int
  from combined c
  left join users u on lower(u.wallet_address) = lower(c.wallet)
  order by c.total_pts desc
  limit p_limit;
$$ language sql stable;
