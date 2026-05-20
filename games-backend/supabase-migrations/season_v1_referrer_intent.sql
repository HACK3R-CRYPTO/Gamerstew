-- Season 1: server-side referrer capture + "pay at join" referral rules.
--
-- The original flow stashed the referrer in localStorage between /mint
-- and the team picker. That was fragile — cross-device, incognito, and
-- cache clears all dropped the value. This migration moves the value to
-- a small server-side table that the join endpoint reads as a fallback
-- when no URL ?ref is present.
--
-- Same migration also lifts the "referee must hit 40 games before the
-- referrer is credited" gate. The 10-referee cap stays (max +1,000 pts
-- per wallet), so the worst-case sybil pay-out is bounded — but the
-- credit lands the moment the referee joins, not weeks later.

-- ─── 1. Referrer intent table ──────────────────────────────────────────────
-- Written once at mint time, read at team-join time. One row per wallet.
-- We never update after first write — the mint screen is the lock-in
-- moment by design.

create table if not exists season_v1_referrer_intent (
  wallet           text primary key,
  referrer_wallet  text not null,
  set_at           timestamptz not null default now()
);

create index if not exists idx_season_v1_referrer_intent_referrer
  on season_v1_referrer_intent (lower(referrer_wallet));

-- ─── 2. Pay-at-join referral credit ────────────────────────────────────────
-- Drops the >= 40 game qualifier. A referrer earns the moment their
-- referee joins a team, capped at 10 referees per wallet (+1,000 max).

create or replace function season_v1_referral_credit(p_wallet text)
returns int as $$
  with meta as (
    select starts_at, ends_at
    from season_v1_meta
    where active = true
    limit 1
  )
  select least(count(*), 10)::int
  from season_v1_players sp, meta m
  where lower(sp.referrer_wallet) = lower(p_wallet)
    and sp.joined_at >= m.starts_at
    and sp.joined_at <= m.ends_at;
$$ language sql stable;

-- ─── 3. Solo top-N: same rule applied inline ──────────────────────────────
-- season_v1_solo_top_full has its own referrals CTE for ranking purposes
-- (so refs × 100 contributes to total_pts). It also had the 40-game gate;
-- mirror the same drop here so personal and public displays agree.

drop function if exists season_v1_solo_top_full(int);

create or replace function season_v1_solo_top_full(p_limit int)
returns table (
  wallet   text,
  username text,
  rank     int,
  points   bigint,
  games    int,
  wins     int,
  claims   int,
  refs     int,
  streak   int
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
  -- Pay-at-join: count every referee who joined a team inside the window,
  -- regardless of how many games they played. Cap at 10 (+1,000 max).
  referrals as (
    select
      lower(sp.referrer_wallet) as wallet,
      least(count(*), 10)::int  as refs
    from season_v1_players sp, meta m
    where sp.referrer_wallet is not null
      and sp.joined_at >= m.starts_at
      and sp.joined_at <= m.ends_at
    group by lower(sp.referrer_wallet)
  ),
  active_days as (
    select
      lower(gs.wallet)                                                        as wallet,
      least(count(distinct (gs.started_at at time zone 'UTC')::date), 30)::int as days
    from game_sessions gs, meta m
    where gs.started_at >= m.starts_at
      and gs.started_at <= m.ends_at
    group by lower(gs.wallet)
  ),
  combined as (
    select
      coalesce(lt.wallet, r.wallet, ad.wallet)                             as wallet,
      coalesce(lt.ledger_pts, 0)
        + (coalesce(r.refs, 0) * 100)
        + (coalesce(ad.days, 0) * 5)                                       as total_pts,
      coalesce(lt.games, 0)                                                as games,
      coalesce(lt.wins, 0)                                                 as wins,
      coalesce(lt.claims, 0)                                               as claims,
      coalesce(r.refs, 0)                                                  as refs,
      coalesce(ad.days, 0)                                                 as streak
    from ledger_totals lt
    full outer join referrals   r  on lower(lt.wallet) = r.wallet
    full outer join active_days ad on lower(coalesce(lt.wallet, r.wallet)) = ad.wallet
  )
  select
    c.wallet,
    u.username,
    (row_number() over (order by c.total_pts desc))::int as rank,
    c.total_pts::bigint as points,
    c.games::int,
    c.wins::int,
    c.claims::int,
    c.refs::int,
    c.streak::int
  from combined c
  left join users u on lower(u.wallet_address) = lower(c.wallet)
  order by c.total_pts desc
  limit p_limit;
$$ language sql stable;
