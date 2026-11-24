-- Admin dashboard: history, events, verification, payouts, admin accounts.
--
-- Run once in the Supabase SQL editor. Safe to run again. After it has run,
-- call   select admin_backfill();   once: it rebuilds every past day from the
-- runs already recorded, so history starts at launch and not today.
--
-- Everything here is read and written by the backend's service key only. Row
-- level security is switched on with no policies, so the public (anon) key can
-- read none of it.

-- ── tables ───────────────────────────────────────────────────────────────────
create table if not exists admin_users (
  email         text primary key,
  name          text,
  role          text not null check (role in ('super_admin', 'admin', 'analyst')),
  pass_hash     text not null,
  disabled      boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    text,
  last_login_at timestamptz
);

-- everything an admin does that changes something, or signs in
create table if not exists admin_actions (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  admin_email text not null,
  action      text not null,
  detail      jsonb
);
create index if not exists admin_actions_at on admin_actions (at desc);

-- things that happen and have no table of their own (a failed transaction, a
-- verification, a payout recorded). Append only.
create table if not exists platform_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  kind    text not null,
  wallet  text,
  game    text,
  ref     text,
  tx_hash text,
  data    jsonb
);
create index if not exists platform_events_at on platform_events (at desc);
create index if not exists platform_events_kind on platform_events (kind, at desc);
create index if not exists platform_events_wallet on platform_events (wallet, at desc);

-- one number per day per metric: the history the dashboard charts
create table if not exists daily_metrics (
  day        date not null,
  metric     text not null,
  value      numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, metric)
);

-- when each wallet was first seen playing
create table if not exists player_first_seen (
  wallet   text primary key,
  first_at timestamptz not null
);
create index if not exists player_first_seen_at on player_first_seen (first_at);

-- GoodDollar verification, as last checked on the chain
create table if not exists verification_status (
  wallet            text primary key,
  verified          boolean not null default false,
  first_verified_at timestamptz,   -- when WE first saw it verified, not when it was verified
  checked_at        timestamptz
);
create index if not exists verification_status_checked on verification_status (checked_at nulls first);

-- every prize or reward paid to a player
create table if not exists payouts (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  wallet      text not null,
  amount      numeric not null check (amount > 0),
  token       text not null default 'G$',
  reason      text,                 -- what it was for: "Weekly ladder, week 42, 1st"
  status      text not null default 'sent' check (status in ('pending', 'sent', 'confirmed', 'failed')),
  tx_hash     text,
  paid_at     timestamptz,
  note        text,
  recorded_by text
);
create index if not exists payouts_wallet on payouts (wallet, created_at desc);
create index if not exists payouts_paid on payouts (paid_at desc);
create unique index if not exists payouts_tx_wallet on payouts (tx_hash, wallet) where tx_hash is not null;

-- Visits and product events, signed in or not. `anon_id` is a random id kept in
-- the browser; no IP address is stored. One row per page view or named event.
create table if not exists site_events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  anon_id text not null,
  wallet  text,                 -- set when the visitor is signed in
  kind    text not null default 'pageview',
  path    text,
  ref     text,                 -- the site they came from (host only), first page of a visit
  device  text,                 -- phone | tablet | desktop
  embed   text,                 -- 'minipay', 'vatar' or null
  props   jsonb
);
create index if not exists site_events_at on site_events (at desc);
create index if not exists site_events_anon on site_events (anon_id, at);
create index if not exists site_events_kind_at on site_events (kind, at desc);

-- when each browser was first seen
create table if not exists visitor_first_seen (
  anon_id  text primary key,
  first_at timestamptz not null
);

alter table site_events enable row level security;
alter table visitor_first_seen enable row level security;
alter table admin_users enable row level security;
alter table admin_actions enable row level security;
alter table platform_events enable row level security;
alter table daily_metrics enable row level security;
alter table player_first_seen enable row level security;
alter table verification_status enable row level security;
alter table payouts enable row level security;

create index if not exists game_sessions_started on game_sessions (started_at);
create index if not exists game_sessions_wallet_started on game_sessions (wallet, started_at desc);

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function admin_put(d date, m text, v numeric) returns void language sql as $$
  insert into daily_metrics (day, metric, value, updated_at) values (d, m, coalesce(v, 0), now())
  on conflict (day, metric) do update set value = excluded.value, updated_at = now();
$$;

create or replace function admin_refresh_first_seen() returns void language sql as $$
  insert into visitor_first_seen (anon_id, first_at)
  select anon_id, min(at) from site_events where at >= now() - interval '3 days' group by anon_id
  on conflict (anon_id) do update set first_at = least(visitor_first_seen.first_at, excluded.first_at);
  insert into player_first_seen (wallet, first_at)
  select lower(wallet), min(started_at) from game_sessions where wallet is not null group by lower(wallet)
  on conflict (wallet) do update set first_at = least(player_first_seen.first_at, excluded.first_at);
$$;

-- Work out one day's numbers and store them. Days are UTC. Each optional table
-- is read inside its own guard, so a table or column that is missing leaves
-- that metric out instead of failing the whole day.
create or replace function admin_rollup_day(d date) returns void language plpgsql as $$
declare
  t0 timestamptz := d::timestamp at time zone 'UTC';
  t1 timestamptz := (d + 1)::timestamp at time zone 'UTC';
  r record;
  n_active numeric; n_new numeric;
begin
  select count(*) as started, count(*) filter (where used) as completed, count(*) filter (where saved_at is not null) as saved,
         count(*) filter (where tx_hash is not null) as onchain, count(distinct lower(wallet)) as players
    into r from game_sessions where started_at >= t0 and started_at < t1;
  perform admin_put(d, 'runs_started', r.started);
  perform admin_put(d, 'runs_completed', r.completed);
  perform admin_put(d, 'runs_abandoned', r.started - r.completed);
  perform admin_put(d, 'runs_saved', r.saved);
  perform admin_put(d, 'runs_onchain', r.onchain);
  perform admin_put(d, 'active_players', r.players);
  n_active := r.players;

  select count(*) into n_new from player_first_seen where first_at >= t0 and first_at < t1;
  perform admin_put(d, 'new_players', n_new);
  perform admin_put(d, 'returning_players', greatest(n_active - n_new, 0));

  delete from daily_metrics where day = d and (metric like 'plays:%' or metric like 'players:%' or metric like 'completed:%');
  for r in select game, count(*) as started, count(*) filter (where used) as completed, count(distinct lower(wallet)) as players
           from game_sessions where started_at >= t0 and started_at < t1 group by game loop
    perform admin_put(d, 'plays:' || r.game, r.started);
    perform admin_put(d, 'completed:' || r.game, r.completed);
    perform admin_put(d, 'players:' || r.game, r.players);
  end loop;

  begin
    select count(*) as n, count(distinct lower(wallet)) as p into r from arena_free_matches where created_at >= t0 and created_at < t1;
    perform admin_put(d, 'markov_matches', r.n); perform admin_put(d, 'markov_players', r.p);
  exception when undefined_table or undefined_column then null; end;

  begin
    select count(*) as n, coalesce(sum(amount_wei::numeric), 0) / 1e18 as g into r from arena_purchases where created_at >= t0 and created_at < t1;
    perform admin_put(d, 'perk_purchases', r.n); perform admin_put(d, 'perk_g_spent', r.g);
  exception when undefined_table or undefined_column or invalid_text_representation then null; end;

  begin
    select count(*) as n into r from faucet_claims where claimed_at >= t0 and claimed_at < t1;
    perform admin_put(d, 'gas_grants', r.n);
  exception when undefined_table or undefined_column then null; end;

  select count(*) as n, coalesce(sum(amount) filter (where token = 'G$'), 0) as g into r
    from payouts where coalesce(paid_at, created_at) >= t0 and coalesce(paid_at, created_at) < t1 and status in ('sent', 'confirmed');
  perform admin_put(d, 'payouts', r.n); perform admin_put(d, 'payouts_g', r.g);

  select count(*) as n into r from verification_status where first_verified_at >= t0 and first_verified_at < t1;
  perform admin_put(d, 'newly_verified', r.n);
  select count(*) as n into r from platform_events where kind = 'tx_failed' and at >= t0 and at < t1;
  perform admin_put(d, 'tx_failed', r.n);

  -- visits: everyone who opened the app, signed in or not
  select count(*) filter (where kind = 'pageview') as views, count(distinct anon_id) as visitors,
         count(distinct anon_id) filter (where wallet is not null) as signed_in,
         count(distinct anon_id) filter (where device = 'phone') as phones
    into r from site_events where at >= t0 and at < t1;
  perform admin_put(d, 'page_views', r.views);
  perform admin_put(d, 'visitors', r.visitors);
  perform admin_put(d, 'visitors_signed_in', r.signed_in);
  perform admin_put(d, 'visitors_guest', r.visitors - r.signed_in);
  perform admin_put(d, 'visitors_phone', r.phones);
  select count(*) as n into r from visitor_first_seen where first_at >= t0 and first_at < t1;
  perform admin_put(d, 'new_visitors', r.n);
  select count(distinct anon_id) as n into r from site_events where at >= t0 and at < t1 and kind = 'game_start';
  perform admin_put(d, 'visitors_who_played', r.n);

  -- a running total, kept only for today: it cannot be rebuilt for a past day
  if d = (now() at time zone 'UTC')::date then
    select count(*) filter (where verified) as v into r from verification_status;
    perform admin_put(d, 'verified_total', r.v);
    begin
      select count(*) as n into r from users;
      perform admin_put(d, 'registered_total', r.n);
    exception when undefined_table then null; end;
  end if;
end $$;

-- Rebuild every day from the first recorded run to today. Run once after the migration.
create or replace function admin_backfill() returns integer language plpgsql as $$
declare d date; first_day date; n integer := 0;
begin
  perform admin_refresh_first_seen();
  select min(started_at at time zone 'UTC')::date into first_day from game_sessions;
  if first_day is null then return 0; end if;
  for d in select generate_series(first_day, (now() at time zone 'UTC')::date, interval '1 day')::date loop
    perform admin_rollup_day(d); n := n + 1;
  end loop;
  return n;
end $$;

-- Called by the backend every hour: today and yesterday.
create or replace function admin_rollup_recent() returns void language plpgsql as $$
begin
  perform admin_refresh_first_seen();
  perform admin_rollup_day(((now() at time zone 'UTC')::date - 1));
  perform admin_rollup_day((now() at time zone 'UTC')::date);
  -- money is stored by its own function (defined further down), once it exists
  begin perform admin_rollup_money_all(); exception when undefined_function or undefined_table then null; end;
end $$;

-- ── reads ────────────────────────────────────────────────────────────────────
create or replace function admin_overview() returns jsonb language plpgsql stable as $$
declare o jsonb := '{}'::jsonb; n numeric; r record; now_utc timestamptz := now();
begin
  begin select count(*) into n from users; o := o || jsonb_build_object('registered', n); exception when undefined_table then null; end;
  select count(*) into n from player_first_seen; o := o || jsonb_build_object('players_ever', n);
  select count(*) filter (where verified) as v, count(*) filter (where not verified and checked_at is not null) as u, count(*) as c into r from verification_status;
  o := o || jsonb_build_object('verified', r.v, 'unverified', r.u, 'verification_checked', r.c);
  select count(*) as started, count(*) filter (where used) as completed, count(*) filter (where saved_at is not null) as saved, count(*) filter (where tx_hash is not null) as onchain into r from game_sessions;
  o := o || jsonb_build_object('runs_started', r.started, 'runs_completed', r.completed, 'runs_saved', r.saved, 'score_transactions', r.onchain);
  select count(distinct lower(wallet)) filter (where started_at >= now_utc - interval '1 day') as d,
         count(distinct lower(wallet)) filter (where started_at >= now_utc - interval '7 days') as w,
         count(distinct lower(wallet)) as m into r from game_sessions where started_at >= now_utc - interval '30 days';
  o := o || jsonb_build_object('dau', r.d, 'wau', r.w, 'mau', r.m);
  select count(*) as n, coalesce(sum(amount) filter (where token = 'G$' and status in ('sent', 'confirmed')), 0) as g,
         count(*) filter (where status = 'pending') as pending, count(*) filter (where status = 'failed') as failed into r from payouts;
  o := o || jsonb_build_object('payouts', r.n, 'payouts_g', r.g, 'payouts_pending', r.pending, 'payouts_failed', r.failed);
  begin select count(*) into n from arena_free_matches; o := o || jsonb_build_object('markov_matches', n); exception when undefined_table then null; end;
  begin select count(*) into n from arena_purchases; o := o || jsonb_build_object('perk_purchases', n); exception when undefined_table then null; end;
  begin select count(*) into n from faucet_claims; o := o || jsonb_build_object('gas_grants', n); exception when undefined_table then null; end;
  select count(*) into n from platform_events where kind = 'tx_failed'; o := o || jsonb_build_object('tx_failed', n);
  select count(*) into n from visitor_first_seen; o := o || jsonb_build_object('visitors_ever', n);
  select count(distinct anon_id) filter (where at >= now_utc - interval '1 day') as d, count(distinct anon_id) filter (where at >= now_utc - interval '7 days') as w, count(distinct anon_id) as m
    into r from site_events where at >= now_utc - interval '30 days';
  o := o || jsonb_build_object('visitors_day', r.d, 'visitors_week', r.w, 'visitors_month', r.m);
  select min(at) into r from site_events; o := o || jsonb_build_object('visits_tracked_from', r.min);
  select min(day) into r from daily_metrics; o := o || jsonb_build_object('history_from', r.min);
  return o;
end $$;

create or replace function admin_series(from_day date, to_day date) returns table (day date, metric text, value numeric) language sql stable as $$
  select day, metric, value from daily_metrics where day between from_day and to_day order by day;
$$;

-- per game, for a range of days
create or replace function admin_games(from_day date, to_day date) returns table (game text, started bigint, completed bigint, abandoned bigint, saved bigint, players bigint, avg_score numeric, best_score numeric)
language sql stable as $$
  select game, count(*), count(*) filter (where used), count(*) filter (where not used), count(*) filter (where saved_at is not null),
         count(distinct lower(wallet)), round(avg(computed_score) filter (where used), 1), max(computed_score)
  from game_sessions
  where started_at >= from_day::timestamp at time zone 'UTC' and started_at < (to_day + 1)::timestamp at time zone 'UTC'
  group by game order by 2 desc;
$$;

-- the most active players in a range
create or replace function admin_top_players(from_day date, to_day date, lim int default 25) returns table (wallet text, runs bigint, completed bigint, games bigint, days bigint, last_at timestamptz)
language sql stable as $$
  select lower(wallet), count(*), count(*) filter (where used), count(distinct game), count(distinct (started_at at time zone 'UTC')::date), max(started_at)
  from game_sessions
  where started_at >= from_day::timestamp at time zone 'UTC' and started_at < (to_day + 1)::timestamp at time zone 'UTC'
  group by lower(wallet) order by 2 desc limit greatest(1, least(lim, 200));
$$;

-- one page of players, newest activity first. `q` matches any part of the wallet.
create or replace function admin_players(q text default '', who text default 'all', lim int default 25, off int default 0)
returns table (wallet text, first_at timestamptz, last_at timestamptz, runs bigint, completed bigint, games bigint, verified boolean, total bigint)
language sql stable as $$
  with base as (
    select f.wallet, f.first_at, v.verified
    from player_first_seen f left join verification_status v on v.wallet = f.wallet
    where (q = '' or f.wallet like '%' || lower(q) || '%')
      and (who = 'all' or (who = 'verified' and v.verified is true) or (who = 'unverified' and v.verified is not true))
  ), agg as (
    select lower(s.wallet) as wallet, max(s.started_at) as last_at, count(*) as runs, count(*) filter (where s.used) as completed, count(distinct s.game) as games
    from game_sessions s where lower(s.wallet) in (select wallet from base) group by lower(s.wallet)
  )
  select b.wallet, b.first_at, a.last_at, coalesce(a.runs, 0), coalesce(a.completed, 0), coalesce(a.games, 0), b.verified, (select count(*) from base)
  from base b left join agg a on a.wallet = b.wallet
  order by a.last_at desc nulls last limit greatest(1, least(lim, 200)) offset greatest(off, 0);
$$;

-- everything about one player
create or replace function admin_player(w text) returns jsonb language plpgsql stable as $$
declare o jsonb := jsonb_build_object('wallet', lower(w)); j jsonb;
begin
  begin select to_jsonb(u) into j from users u where lower(u.wallet_address) = lower(w); o := o || jsonb_build_object('user', j); exception when undefined_table or undefined_column then null; end;
  select to_jsonb(f) into j from player_first_seen f where f.wallet = lower(w); o := o || jsonb_build_object('first_seen', j);
  select to_jsonb(v) into j from verification_status v where v.wallet = lower(w); o := o || jsonb_build_object('verification', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select game, count(*) as runs, count(*) filter (where used) as completed, max(computed_score) as best, max(started_at) as last_at
    from game_sessions where lower(wallet) = lower(w) group by game order by 2 desc) x;
  o := o || jsonb_build_object('games', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select game, started_at, used, computed_score as score, tx_hash, saved_at from game_sessions where lower(wallet) = lower(w) order by started_at desc limit 60) x;
  o := o || jsonb_build_object('recent_runs', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select * from payouts where lower(wallet) = lower(w) order by created_at desc limit 100) x;
  o := o || jsonb_build_object('payouts', j);
  begin
    select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select sku, amount_wei::text as amount_wei, tx_hash, created_at from arena_purchases where lower(wallet) = lower(w) order by created_at desc limit 50) x;
    o := o || jsonb_build_object('purchases', j);
  exception when undefined_table or undefined_column then null; end;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select at, kind, game, ref, tx_hash from platform_events where wallet = lower(w) order by at desc limit 50) x;
  o := o || jsonb_build_object('events', j);
  return o;
end $$;

-- The activity feed: one list, newest first, built from the tables that already
-- record these things plus platform_events. `before` pages backwards.
create or replace function admin_feed(lim int default 60, before timestamptz default null, only_kind text default null)
returns table (at timestamptz, kind text, wallet text, game text, detail text, tx_hash text) language plpgsql stable as $$
declare b timestamptz := coalesce(before, now() + interval '1 minute'); l int := greatest(1, least(lim, 300));
begin
  return query
  with parts as (
    (select s.started_at as at, case when s.used then 'game_completed' else 'game_started' end as kind, lower(s.wallet) as wallet, s.game, case when s.used then 'score ' || coalesce(s.computed_score::text, '?') else null end as detail, s.tx_hash
       from game_sessions s where s.started_at < b order by s.started_at desc limit l)
    union all
    (select f.first_at, 'new_player', f.wallet, null, null, null from player_first_seen f where f.first_at < b order by f.first_at desc limit l)
    union all
    (select v.first_verified_at, 'verified', v.wallet, null, null, null from verification_status v where v.first_verified_at is not null and v.first_verified_at < b order by v.first_verified_at desc limit l)
    union all
    (select coalesce(p.paid_at, p.created_at), 'payout_' || p.status, lower(p.wallet), null, p.amount::text || ' ' || p.token || coalesce(' · ' || p.reason, ''), p.tx_hash
       from payouts p where coalesce(p.paid_at, p.created_at) < b order by coalesce(p.paid_at, p.created_at) desc limit l)
    union all
    (select e.at, e.kind, e.wallet, e.game, e.ref, e.tx_hash from platform_events e where e.at < b and e.kind <> 'verified' order by e.at desc limit l)
  )
  select p.at, p.kind, p.wallet, p.game, p.detail, p.tx_hash from parts p
  where only_kind is null or p.kind = only_kind or (only_kind = 'payout' and p.kind like 'payout_%')
  order by p.at desc limit l;
end $$;

-- Retention by week. Of the players first seen in a week, how many played in
-- that week and in each week after it.
create or replace function admin_retention(weeks int default 8) returns table (cohort date, cohort_size bigint, week_offset int, players bigint) language sql stable as $$
  with coh as (
    select wallet, date_trunc('week', first_at at time zone 'UTC')::date as cohort from player_first_seen
    where first_at >= date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => greatest(1, least(weeks, 26)))
  ), act as (
    select distinct lower(wallet) as wallet, date_trunc('week', started_at at time zone 'UTC')::date as wk from game_sessions
    where started_at >= date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => greatest(1, least(weeks, 26)))
  ), size as (select cohort, count(*) as n from coh group by cohort)
  select c.cohort, s.n, ((a.wk - c.cohort) / 7)::int, count(*)
  from coh c join act a on a.wallet = c.wallet and a.wk >= c.cohort join size s on s.cohort = c.cohort
  group by c.cohort, s.n, a.wk order by c.cohort, 3;
$$;

create or replace function admin_verification() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'verified', (select count(*) from verification_status where verified),
    'unverified', (select count(*) from verification_status where not verified and checked_at is not null),
    'not_checked_yet', (select count(*) from player_first_seen f where not exists (select 1 from verification_status v where v.wallet = f.wallet and v.checked_at is not null)),
    'verified_played', (select count(*) from verification_status v where v.verified and exists (select 1 from game_sessions s where lower(s.wallet) = v.wallet and s.used)),
    'verified_never_played', (select count(*) from verification_status v where v.verified and not exists (select 1 from game_sessions s where lower(s.wallet) = v.wallet and s.used)),
    'last_checked', (select max(checked_at) from verification_status)
  );
$$;

-- the wallets whose verification is the most out of date (never checked first)
create or replace function admin_verify_queue(lim int default 30) returns table (wallet text) language plpgsql stable as $$
begin
  return query
  with known as (
    select f.wallet from player_first_seen f
    union select lower(u.wallet_address) from users u where u.wallet_address is not null
  )
  select k.wallet from known k left join verification_status v on v.wallet = k.wallet
  order by v.checked_at asc nulls first limit greatest(1, least(lim, 200));
exception when undefined_table or undefined_column then
  return query select f.wallet from player_first_seen f left join verification_status v on v.wallet = f.wallet order by v.checked_at asc nulls first limit greatest(1, least(lim, 200));
end $$;

-- record the result of one check; a change to verified becomes an event
create or replace function admin_set_verified(w text, is_verified boolean) returns boolean language plpgsql as $$
declare was boolean;
begin
  select verified into was from verification_status where wallet = lower(w);
  insert into verification_status (wallet, verified, first_verified_at, checked_at)
  values (lower(w), is_verified, case when is_verified then now() end, now())
  on conflict (wallet) do update set verified = excluded.verified, checked_at = now(),
    first_verified_at = coalesce(verification_status.first_verified_at, case when excluded.verified then now() end);
  if is_verified and was is not true then
    insert into platform_events (kind, wallet) values ('verified', lower(w));
    return true;
  end if;
  return false;
end $$;

-- where visitors came from, and which pages they opened, in a range of days
create or replace function admin_traffic(from_day date, to_day date) returns jsonb language sql stable as $$
  with e as (select * from site_events where at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC')
  select jsonb_build_object(
    'pages', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select path, count(*) as views, count(distinct anon_id) as visitors from e where kind = 'pageview' group by path order by 2 desc limit 30) x),
    'sources', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select coalesce(nullif(ref, ''), 'direct') as source, count(distinct anon_id) as visitors from e where kind = 'pageview' group by 1 order by 2 desc limit 20) x),
    'devices', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select coalesce(device, 'unknown') as device, count(distinct anon_id) as visitors from e group by 1 order by 2 desc) x),
    'embeds', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select coalesce(embed, 'web') as where_, count(distinct anon_id) as visitors from e group by 1 order by 2 desc) x),
    'events', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select kind, count(*) as n, count(distinct anon_id) as visitors from e group by kind order by 2 desc limit 30) x),
    -- the funnel: opened the app, opened a game, started a run, signed in
    'funnel', jsonb_build_object(
      'visited', (select count(distinct anon_id) from e),
      'opened_a_game', (select count(distinct anon_id) from e where kind = 'pageview' and (path like '/games/%' or path in ('/world', '/bowling'))),
      'started_a_run', (select count(distinct anon_id) from e where kind = 'game_start'),
      'signed_in', (select count(distinct anon_id) from e where wallet is not null))
  );
$$;

-- store a batch of events sent by the site: [{anon_id, wallet, kind, path, ref, device, embed, props}]
create or replace function admin_track(batch jsonb) returns integer language plpgsql as $$
declare n integer;
begin
  insert into site_events (anon_id, wallet, kind, path, ref, device, embed, props)
  select left(x->>'anon_id', 40), nullif(lower(left(x->>'wallet', 42)), ''), left(coalesce(x->>'kind', 'pageview'), 40), left(x->>'path', 200),
         nullif(left(x->>'ref', 120), ''), nullif(left(x->>'device', 12), ''), nullif(left(x->>'embed', 12), ''), x->'props'
  from jsonb_array_elements(batch) x where coalesce(x->>'anon_id', '') <> '';
  get diagnostics n = row_count;
  insert into visitor_first_seen (anon_id, first_at)
  select distinct left(x->>'anon_id', 40), now() from jsonb_array_elements(batch) x where coalesce(x->>'anon_id', '') <> ''
  on conflict (anon_id) do nothing;
  return n;
end $$;


-- ── money: every purchase, read from the chain ───────────────────────────────
-- The PerkShop and HabitatRegistry contracts emit an event for each purchase
-- with the exact split: how much the player paid, how much went to the UBI
-- pool, how much GameArena's treasury kept. The backend reads those events in
-- order and stores them here. `chain_cursor` is how far it has read.
create table if not exists purchases (
  tx_hash   text not null,
  log_index integer not null,
  block     bigint not null,
  at        timestamptz not null,
  kind      text not null check (kind in ('perk', 'habitat')),
  wallet    text not null,
  item      integer not null,          -- perk id, or habitat tier
  total     numeric not null,          -- what the player paid, in G$
  ubi       numeric not null,          -- the share sent to the UBI pool
  treasury  numeric not null,          -- the share GameArena kept
  primary key (tx_hash, log_index)
);
create index if not exists purchases_at on purchases (at desc);
create index if not exists purchases_wallet on purchases (wallet, at desc);
create table if not exists chain_cursor (
  name       text primary key,
  block      bigint not null,
  updated_at timestamptz not null default now()
);
alter table purchases enable row level security;
alter table chain_cursor enable row level security;

create or replace function admin_chain_cursor(cursor_name text) returns bigint language sql stable as $$
  select block from chain_cursor where name = cursor_name;
$$;

-- Store a batch of purchases and move the cursor, together: either both happen
-- or neither does, so a block range is never half recorded.
create or replace function admin_save_purchases(cursor_name text, upto bigint, batch jsonb) returns integer language plpgsql as $$
declare n integer;
begin
  insert into purchases (tx_hash, log_index, block, at, kind, wallet, item, total, ubi, treasury)
  select lower(x->>'tx_hash'), (x->>'log_index')::int, (x->>'block')::bigint, to_timestamp((x->>'at')::bigint), x->>'kind', lower(x->>'wallet'),
         (x->>'item')::int, (x->>'total')::numeric, (x->>'ubi')::numeric, (x->>'treasury')::numeric
  from jsonb_array_elements(batch) x
  on conflict (tx_hash, log_index) do nothing;
  get diagnostics n = row_count;
  insert into chain_cursor (name, block, updated_at) values (cursor_name, upto, now())
  on conflict (name) do update set block = greatest(chain_cursor.block, excluded.block), updated_at = now();
  return n;
end $$;

-- one day's money, stored with the day's other numbers
create or replace function admin_rollup_money(d date) returns void language plpgsql as $$
declare t0 timestamptz := d::timestamp at time zone 'UTC'; t1 timestamptz := (d + 1)::timestamp at time zone 'UTC'; r record;
begin
  select count(*) as n, count(distinct wallet) as buyers, coalesce(sum(total), 0) as spent, coalesce(sum(treasury), 0) as kept, coalesce(sum(ubi), 0) as ubi,
         coalesce(sum(treasury) filter (where kind = 'perk'), 0) as perk, coalesce(sum(treasury) filter (where kind = 'habitat'), 0) as habitat
    into r from purchases where at >= t0 and at < t1;
  perform admin_put(d, 'purchases', r.n); perform admin_put(d, 'buyers', r.buyers);
  perform admin_put(d, 'spent_g', r.spent); perform admin_put(d, 'revenue_g', r.kept); perform admin_put(d, 'ubi_g', r.ubi);
  perform admin_put(d, 'revenue_perk_g', r.perk); perform admin_put(d, 'revenue_habitat_g', r.habitat);
end $$;

-- money is rebuilt for every day that has a purchase, plus today and yesterday
create or replace function admin_rollup_money_all() returns integer language plpgsql as $$
declare d date; n integer := 0;
begin
  for d in select distinct (at at time zone 'UTC')::date from purchases
           union select (now() at time zone 'UTC')::date union select (now() at time zone 'UTC')::date - 1 loop
    perform admin_rollup_money(d); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function admin_money(from_day date, to_day date) returns jsonb language sql stable as $$
  with p as (select * from purchases where at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC'),
       paid as (select coalesce(sum(amount) filter (where token = 'G$' and status in ('sent', 'confirmed')), 0) as g from payouts
                where coalesce(paid_at, created_at) >= from_day::timestamp at time zone 'UTC' and coalesce(paid_at, created_at) < (to_day + 1)::timestamp at time zone 'UTC')
  select jsonb_build_object(
    'period', (select jsonb_build_object('purchases', count(*), 'buyers', count(distinct wallet), 'spent', coalesce(sum(total), 0), 'kept', coalesce(sum(treasury), 0), 'ubi', coalesce(sum(ubi), 0)) from p),
    'all_time', (select jsonb_build_object('purchases', count(*), 'buyers', count(distinct wallet), 'spent', coalesce(sum(total), 0), 'kept', coalesce(sum(treasury), 0), 'ubi', coalesce(sum(ubi), 0), 'first', min(at)) from purchases),
    'prizes_paid', (select g from paid),
    'prizes_paid_all_time', (select coalesce(sum(amount) filter (where token = 'G$' and status in ('sent', 'confirmed')), 0) from payouts),
    'by_item', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select kind, item, count(*) as n, count(distinct wallet) as buyers, sum(total) as spent, sum(treasury) as kept from p group by kind, item order by sum(treasury) desc) x),
    'top_spenders', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select wallet, count(*) as n, sum(total) as spent, sum(treasury) as kept from p group by wallet order by sum(total) desc limit 15) x),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select at, kind, item, wallet, total, treasury, ubi, tx_hash from p order by at desc limit 40) x),
    'read_to_block', (select block from chain_cursor where name = 'purchases'),
    'read_at', (select updated_at from chain_cursor where name = 'purchases')
  );
$$;
