-- Season 1: Team Wars + Solo Ladder
-- Two parallel tracks running off the same gameplay.
--   Team Wars  — 3 teams race to 500 counted games. Base prize per team
--                that hits target + bonus to top scorer. Best-Effort
--                safety net pays the top team if no team hits 500 but at
--                least one team hits 300+.
--   Solo Ladder — every action earns points. Top 10 scorers split a
--                separate pool.
--
-- Schema is generic enough to support future seasons by bumping the
-- table suffix. Reads from existing game_sessions for gameplay; writes
-- to its own point ledger for the Solo Ladder.

-- ─── Team assignment ─────────────────────────────────────────────────
-- One row per wallet that joined the season. Soft cap (1.5x smallest
-- team) is enforced in the join API route, not the table.
create table if not exists season_v1_players (
  wallet            text primary key,
  team              text not null check (team in ('alpha', 'nova', 'pulse')),
  referrer_wallet   text,                   -- optional, set at join time
  joined_at         timestamptz not null default now(),
  -- Locked at the season config's lock_at timestamp. After that, team
  -- can't change. Set to true once any qualifying activity happens.
  team_locked       boolean not null default false
);

create index if not exists idx_season_v1_players_team
  on season_v1_players (team);
create index if not exists idx_season_v1_players_referrer
  on season_v1_players (lower(referrer_wallet)) where referrer_wallet is not null;

-- ─── Point ledger (Solo Ladder) ──────────────────────────────────────
-- Append-only. Every points-earning action writes one row. Lets us
-- audit + recompute scores without depending on derived state.
create table if not exists season_v1_points (
  id           bigserial primary key,
  wallet       text not null,
  action_type  text not null check (action_type in (
    'game_played',
    'wager_won',
    'habitat_bought',
    'daily_claim',
    'referral_qualified'
  )),
  points       integer not null,
  ref          text,                      -- match_id, habitat token id, etc.
  occurred_at  timestamptz not null default now()
);

create index if not exists idx_season_v1_points_wallet
  on season_v1_points (lower(wallet), occurred_at desc);
create index if not exists idx_season_v1_points_action_type
  on season_v1_points (action_type, occurred_at desc);

-- ─── Season config ───────────────────────────────────────────────────
-- Single source of truth for the active season's dates + thresholds.
-- Edited by ops via SQL, read by the API on every request. Lets us run
-- the same season schema for future weeks by inserting a new row.
create table if not exists season_v1_meta (
  id                serial primary key,
  active            boolean not null default false,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  lock_at           timestamptz not null,   -- team picks lock after this
  target_per_team   integer not null,       -- 500 for season 1
  best_effort_floor integer not null,       -- 300 for season 1
  best_effort_pool  numeric not null,       -- 1000 G$ in wei-equivalent
  base_per_team     numeric not null,       -- 1200 G$
  top_team_bonus    numeric not null,       -- 1200 G$
  solo_ladder_pool  numeric not null        -- 1200 G$
);

-- Insert the Season 1 config. Hardcoded; ops adjusts via update if needed.
-- Dates: Friday 12:00 UTC to following Friday 12:00 UTC.
-- Set lock_at to ends_at minus 24h to give late joiners 6 days of play
-- but cut off team-switching as the race tightens.
insert into season_v1_meta
  (active, starts_at, ends_at, lock_at, target_per_team, best_effort_floor,
   best_effort_pool, base_per_team, top_team_bonus, solo_ladder_pool)
values
  (
    true,
    '2026-05-22 12:00:00+00',
    '2026-05-29 12:00:00+00',
    '2026-05-28 12:00:00+00',
    500,
    300,
    1000000000000000000000,    -- 1000 G$ in wei (18 decimals)
    1200000000000000000000,    -- 1200 G$
    1200000000000000000000,    -- 1200 G$
    1200000000000000000000     -- 1200 G$
  )
on conflict do nothing;

-- ─── Team counts view ────────────────────────────────────────────────
-- Used by the join endpoint to enforce the soft cap.
create or replace view season_v1_team_counts as
select team, count(*)::int as player_count
from season_v1_players
group by team;

-- ─── Soft cap helper ─────────────────────────────────────────────────
-- Returns true if the requested team is currently open to new joiners
-- (i.e. its size is < 1.5x the smallest team's size, or there are no
-- players yet). Used in the join endpoint.
create or replace function season_v1_team_open(p_team text)
returns boolean as $$
declare
  smallest int;
  this_team int;
begin
  select coalesce(min(player_count), 0) into smallest from season_v1_team_counts;
  select coalesce(sum(player_count), 0) into this_team
    from season_v1_team_counts where team = p_team;
  if smallest = 0 then
    return true; -- first joiners pick freely
  end if;
  return this_team < (smallest * 1.5);
end;
$$ language plpgsql;

-- ─── Counted games per qualifying player ─────────────────────────────
-- Joins season_v1_players to game_sessions inside the season window.
-- Applies the 40-min / 100-max rule per wallet. Returns one row per
-- qualifying (player, team), with the counted game total. Leaderboard
-- endpoint sums these per team to compute team scores.
--
-- Wallet matching is lowercased on both sides to avoid checksum-
-- mismatch missing data.
create or replace function season_v1_counted_games(
  p_start timestamptz,
  p_end   timestamptz,
  p_min   int,
  p_max   int
) returns table (team text, wallet text, counted int) as $$
  with raw_counts as (
    select
      sp.team,
      sp.wallet,
      count(*)::int as raw_games
    from season_v1_players sp
    join game_sessions gs on lower(gs.wallet) = lower(sp.wallet)
    where gs.started_at >= p_start
      and gs.started_at <= p_end
    group by sp.team, sp.wallet
  )
  select
    rc.team,
    rc.wallet,
    least(rc.raw_games, p_max)::int as counted
  from raw_counts rc
  where rc.raw_games >= p_min;
$$ language sql stable;

-- ─── Solo Ladder top N ───────────────────────────────────────────────
-- Sums the points ledger per wallet for the active season window. Caps
-- at p_limit rows. Used by the leaderboard endpoint to surface the top
-- 10 individual scorers. The season window comes from season_v1_meta.
create or replace function season_v1_solo_top(p_limit int)
returns table (wallet text, points bigint, rank int) as $$
  with meta as (
    select starts_at, ends_at
    from season_v1_meta
    where active = true
    limit 1
  ),
  totals as (
    select
      pp.wallet,
      sum(pp.points)::bigint as points
    from season_v1_points pp, meta m
    where pp.occurred_at >= m.starts_at
      and pp.occurred_at <= m.ends_at
    group by pp.wallet
  )
  select
    wallet,
    points,
    (row_number() over (order by points desc))::int as rank
  from totals
  order by points desc
  limit p_limit;
$$ language sql stable;

-- ─── Referral credit ─────────────────────────────────────────────────
-- Counts how many wallets joined this season with p_wallet as their
-- referrer AND have already played at least the qualifying minimum
-- inside the season window. Used by /api/season/me to show "you've
-- brought N qualifying friends" and by the prize-distribution job to
-- award the 500-pt referral bonus (done as a separate admin step in
-- v1 so we have human eyes on the first season's referral data).
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
  select count(*)::int from qualified_referees;
$$ language sql stable;
