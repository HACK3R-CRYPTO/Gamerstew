-- Point rebalance + idempotency for Season 1.
--   1. Cap referral credit at 10 qualified referees per wallet. Stops
--      sybil-farming from being the dominant path: 10 × 100 pts = 1000
--      pts max from referrals, equal to a perfect 100-game grind. Real
--      growth still rewarded, exploit boxed in.
--   2. Unique index on (lower(wallet), action_type, ref) so the existing
--      "best-effort" hooks (sign-score, resolveMatch, record-claim) can't
--      double-count if they retry. The agent + backend hooks pass a
--      naturally-unique ref per event already; this just makes the DB
--      enforce it instead of trusting application logic.

create unique index if not exists uniq_season_v1_points_wallet_action_ref
  on season_v1_points (lower(wallet), action_type, ref)
  where ref is not null;

create or replace function season_v1_referral_credit(p_wallet text)
returns int as $$
  with meta as (
    select starts_at, ends_at
    from season_v1_meta
    where active = true
    limit 1
  ),
  qualified_referees as (
    select sp.wallet
    from season_v1_players sp
    join meta m on true
    where lower(sp.referrer_wallet) = lower(p_wallet)
      and (
        select count(*) from game_sessions gs
        where lower(gs.wallet) = lower(sp.wallet)
          and gs.started_at >= m.starts_at
          and gs.started_at <= m.ends_at
      ) >= 40
  )
  -- LEAST applies the 10-referral cap. The award script multiplies the
  -- returned count by 100 pts; with the cap, max referral earnings = 1000.
  select least(count(*), 10)::int from qualified_referees;
$$ language sql stable;
