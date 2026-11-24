-- Admin dashboard, part 2: the chain is the truth.
--
-- Run after 2026-11-25_admin_dashboard.sql. Safe to run again.
--
-- Part 1 counted players and games from two database tables that only hold
-- part of the history (445 player rows, run tickets since May). The GamePass
-- contract has all of it: every mint (who registered, when, under what name)
-- and every recorded score. The backend reads those events into the two tables
-- below, and every number that should match the chain now comes from them.

create table if not exists chain_mints (
  wallet   text primary key,
  token_id bigint,
  username text,
  at       timestamptz not null,
  block    bigint not null,
  tx_hash  text not null
);
create index if not exists chain_mints_at on chain_mints (at desc);
create index if not exists chain_mints_username on chain_mints (lower(username));

create table if not exists chain_scores (
  tx_hash   text not null,
  log_index integer not null,
  block     bigint not null,
  at        timestamptz not null,
  wallet    text not null,
  game_type integer not null,
  score     numeric not null,
  season    integer,
  primary key (tx_hash, log_index)
);
create index if not exists chain_scores_at on chain_scores (at desc);
create index if not exists chain_scores_wallet on chain_scores (wallet, at desc);
create index if not exists chain_scores_game on chain_scores (game_type, at desc);
alter table chain_mints enable row level security;
alter table chain_scores enable row level security;

alter table verification_status add column if not exists verified_at timestamptz; -- the date on the GoodDollar contract itself

create or replace function admin_game_name(t integer) returns text language sql immutable as $$
  select case t when 0 then 'rhythm' when 1 then 'simon' when 2 then 'stack' when 3 then 'challenge-ai' when 4 then 'nepa'
                when 5 then 'ladder' when 6 then 'strike' when 7 then 'nepa3d' else 'partner-' || t::text end;
$$;

-- store one block range of GamePass events and move the cursor, together
create or replace function admin_save_gamepass(cursor_name text, upto bigint, mints jsonb, scores jsonb, renames jsonb) returns integer language plpgsql as $$
declare n integer; m integer;
begin
  insert into chain_mints (wallet, token_id, username, at, block, tx_hash)
  select lower(x->>'wallet'), (x->>'token_id')::bigint, x->>'username', to_timestamp((x->>'at')::bigint), (x->>'block')::bigint, lower(x->>'tx_hash')
  from jsonb_array_elements(mints) x
  on conflict (wallet) do nothing;
  get diagnostics n = row_count;
  update chain_mints c set username = r.username
  from (select lower(x->>'wallet') as wallet, x->>'username' as username from jsonb_array_elements(renames) x) r where c.wallet = r.wallet;
  insert into chain_scores (tx_hash, log_index, block, at, wallet, game_type, score, season)
  select lower(x->>'tx_hash'), (x->>'log_index')::int, (x->>'block')::bigint, to_timestamp((x->>'at')::bigint), lower(x->>'wallet'), (x->>'game_type')::int, (x->>'score')::numeric, (x->>'season')::int
  from jsonb_array_elements(scores) x
  on conflict (tx_hash, log_index) do nothing;
  get diagnostics m = row_count;
  insert into chain_cursor (name, block, updated_at) values (cursor_name, upto, now())
  on conflict (name) do update set block = greatest(chain_cursor.block, excluded.block), updated_at = now();
  return n + m;
end $$;

-- a wallet is first seen at its mint, its first score, or its first run ticket, whichever is earliest
create or replace function admin_refresh_first_seen() returns void language sql as $$
  insert into visitor_first_seen (anon_id, first_at)
  select anon_id, min(at) from site_events where at >= now() - interval '3 days' group by anon_id
  on conflict (anon_id) do update set first_at = least(visitor_first_seen.first_at, excluded.first_at);
  insert into player_first_seen (wallet, first_at)
  select wallet, min(at) from (
    select lower(wallet) as wallet, started_at as at from game_sessions where wallet is not null
    union all select wallet, at from chain_scores
    union all select wallet, at from chain_mints
  ) x group by wallet
  on conflict (wallet) do update set first_at = least(player_first_seen.first_at, excluded.first_at);
$$;

create or replace function admin_rollup_day(d date) returns void language plpgsql as $$
declare
  t0 timestamptz := d::timestamp at time zone 'UTC';
  t1 timestamptz := (d + 1)::timestamp at time zone 'UTC';
  r record; n_active numeric; n_new numeric;
begin
  -- run tickets: what was started, and how much of it was finished
  select count(*) as started, count(*) filter (where used) as completed, count(*) filter (where saved_at is not null) as saved
    into r from game_sessions where started_at >= t0 and started_at < t1;
  perform admin_put(d, 'runs_started', r.started);
  perform admin_put(d, 'runs_completed', r.completed);
  perform admin_put(d, 'runs_abandoned', r.started - r.completed);
  perform admin_put(d, 'runs_saved', r.saved);

  -- the chain: every score that was recorded
  select count(*) as n, count(distinct wallet) as p into r from chain_scores where at >= t0 and at < t1;
  perform admin_put(d, 'games_played', r.n);
  perform admin_put(d, 'runs_onchain', r.n);
  perform admin_put(d, 'players_onchain', r.p);

  -- active: anyone who started a run or recorded a score that day
  select count(*) into n_active from (
    select lower(wallet) as w from game_sessions where started_at >= t0 and started_at < t1
    union select wallet from chain_scores where at >= t0 and at < t1) x;
  perform admin_put(d, 'active_players', n_active);
  select count(*) into n_new from player_first_seen where first_at >= t0 and first_at < t1;
  perform admin_put(d, 'new_players', n_new);
  perform admin_put(d, 'returning_players', greatest(n_active - n_new, 0));
  select count(*) as n into r from chain_mints where at >= t0 and at < t1;
  perform admin_put(d, 'registered_new', r.n);

  delete from daily_metrics where day = d and (metric like 'plays:%' or metric like 'players:%' or metric like 'completed:%' or metric like 'started:%');
  for r in select admin_game_name(game_type) as game, count(*) as n, count(distinct wallet) as p from chain_scores where at >= t0 and at < t1 group by game_type loop
    perform admin_put(d, 'plays:' || r.game, r.n);
    perform admin_put(d, 'players:' || r.game, r.p);
  end loop;
  for r in select game, count(*) as started, count(*) filter (where used) as completed from game_sessions where started_at >= t0 and started_at < t1 group by game loop
    perform admin_put(d, 'started:' || r.game, r.started);
    perform admin_put(d, 'completed:' || r.game, r.completed);
  end loop;

  begin
    select count(*) as n, count(distinct lower(wallet)) as p into r from arena_free_matches where created_at >= t0 and created_at < t1;
    perform admin_put(d, 'markov_matches', r.n); perform admin_put(d, 'markov_players', r.p);
  exception when undefined_table or undefined_column then null; end;
  begin
    select count(*) as n into r from faucet_claims where claimed_at >= t0 and claimed_at < t1;
    perform admin_put(d, 'gas_grants', r.n);
  exception when undefined_table or undefined_column then null; end;

  select count(*) as n, coalesce(sum(amount) filter (where token = 'G$'), 0) as g into r
    from payouts where coalesce(paid_at, created_at) >= t0 and coalesce(paid_at, created_at) < t1 and status in ('sent', 'confirmed');
  perform admin_put(d, 'payouts', r.n); perform admin_put(d, 'payouts_g', r.g);
  -- verification by the date on the GoodDollar contract when we have it
  select count(*) as n into r from verification_status where coalesce(verified_at, first_verified_at) >= t0 and coalesce(verified_at, first_verified_at) < t1;
  perform admin_put(d, 'newly_verified', r.n);
  select count(*) as n into r from platform_events where kind = 'tx_failed' and at >= t0 and at < t1;
  perform admin_put(d, 'tx_failed', r.n);

  select count(*) filter (where kind = 'pageview') as views, count(distinct anon_id) as visitors,
         count(distinct anon_id) filter (where wallet is not null) as signed_in, count(distinct anon_id) filter (where device = 'phone') as phones
    into r from site_events where at >= t0 and at < t1;
  perform admin_put(d, 'page_views', r.views); perform admin_put(d, 'visitors', r.visitors);
  perform admin_put(d, 'visitors_signed_in', r.signed_in); perform admin_put(d, 'visitors_guest', r.visitors - r.signed_in); perform admin_put(d, 'visitors_phone', r.phones);
  select count(*) as n into r from visitor_first_seen where first_at >= t0 and first_at < t1;
  perform admin_put(d, 'new_visitors', r.n);
  select count(distinct anon_id) as n into r from site_events where at >= t0 and at < t1 and kind = 'game_start';
  perform admin_put(d, 'visitors_who_played', r.n);

  -- running totals as they stood at the end of this day: these CAN be rebuilt, the chain has the dates
  select count(*) as n into r from chain_mints where at < t1; perform admin_put(d, 'registered_total', r.n);
  select count(*) as n into r from player_first_seen where first_at < t1; perform admin_put(d, 'players_total', r.n);
  select count(*) as n into r from chain_scores where at < t1; perform admin_put(d, 'games_total', r.n);
  select count(*) as n into r from verification_status where verified and coalesce(verified_at, first_verified_at) < t1; perform admin_put(d, 'verified_total', r.n);
end $$;

create or replace function admin_backfill() returns integer language plpgsql as $$
declare d date; first_day date; n integer := 0;
begin
  perform admin_refresh_first_seen();
  select min(first_at at time zone 'UTC')::date into first_day from player_first_seen;
  if first_day is null then return 0; end if;
  for d in select generate_series(first_day, (now() at time zone 'UTC')::date, interval '1 day')::date loop
    perform admin_rollup_day(d); n := n + 1;
  end loop;
  begin perform admin_rollup_money_all(); exception when undefined_function or undefined_table then null; end;
  return n;
end $$;

create or replace function admin_overview() returns jsonb language plpgsql stable as $$
declare o jsonb := '{}'::jsonb; n numeric; r record; now_utc timestamptz := now();
begin
  select count(*) into n from chain_mints; o := o || jsonb_build_object('registered', n);
  begin select count(*) into n from users; o := o || jsonb_build_object('db_users', n); exception when undefined_table then null; end;
  select count(*) into n from player_first_seen; o := o || jsonb_build_object('players_ever', n);
  select count(distinct wallet) into n from chain_scores; o := o || jsonb_build_object('players_scored', n);
  select count(*) filter (where verified) as v, count(*) filter (where not verified and checked_at is not null) as u, count(*) filter (where checked_at is not null) as c into r from verification_status;
  o := o || jsonb_build_object('verified', r.v, 'unverified', r.u, 'verification_checked', r.c);
  select count(*) as started, count(*) filter (where used) as completed, count(*) filter (where saved_at is not null) as saved, min(started_at) as since into r from game_sessions;
  o := o || jsonb_build_object('runs_started', r.started, 'runs_completed', r.completed, 'runs_saved', r.saved, 'tickets_since', r.since);
  select count(*) into n from chain_scores; o := o || jsonb_build_object('games_played', n, 'score_transactions', n);
  select count(distinct w) filter (where at >= now_utc - interval '1 day') as d, count(distinct w) filter (where at >= now_utc - interval '7 days') as w7, count(distinct w) as m into r
    from (select lower(wallet) as w, started_at as at from game_sessions where started_at >= now_utc - interval '30 days'
          union all select wallet, at from chain_scores where at >= now_utc - interval '30 days') x;
  o := o || jsonb_build_object('dau', r.d, 'wau', r.w7, 'mau', r.m);
  select count(*) as n, coalesce(sum(amount) filter (where token = 'G$' and status in ('sent', 'confirmed')), 0) as g,
         count(*) filter (where status = 'pending') as pending, count(*) filter (where status = 'failed') as failed into r from payouts;
  o := o || jsonb_build_object('payouts', r.n, 'payouts_g', r.g, 'payouts_pending', r.pending, 'payouts_failed', r.failed);
  begin select count(*) into n from arena_free_matches; o := o || jsonb_build_object('markov_matches', n); exception when undefined_table then null; end;
  begin select count(*) into n from faucet_claims; o := o || jsonb_build_object('gas_grants', n); exception when undefined_table then null; end;
  select count(*) into n from purchases; o := o || jsonb_build_object('perk_purchases', n);
  select count(*) into n from platform_events where kind = 'tx_failed'; o := o || jsonb_build_object('tx_failed', n);
  select count(*) into n from visitor_first_seen; o := o || jsonb_build_object('visitors_ever', n);
  select count(distinct anon_id) filter (where at >= now_utc - interval '1 day') as d, count(distinct anon_id) filter (where at >= now_utc - interval '7 days') as w, count(distinct anon_id) as m
    into r from site_events where at >= now_utc - interval '30 days';
  o := o || jsonb_build_object('visitors_day', r.d, 'visitors_week', r.w, 'visitors_month', r.m);
  select min(at) into r from site_events; o := o || jsonb_build_object('visits_tracked_from', r.min);
  select min(day) into r from daily_metrics; o := o || jsonb_build_object('history_from', r.min);
  o := o || jsonb_build_object('chain', (select coalesce(jsonb_object_agg(name, jsonb_build_object('block', block, 'at', updated_at)), '{}'::jsonb) from chain_cursor));
  return o;
end $$;

-- per game: played and players from the chain; started and abandoned from run tickets
drop function if exists admin_games(date, date);
create or replace function admin_games(from_day date, to_day date)
returns table (game text, played bigint, players bigint, avg_score numeric, best_score numeric, started bigint, completed bigint, abandoned bigint, last_at timestamptz)
language sql stable as $$
  with c as (
    select admin_game_name(game_type) as game, count(*) as played, count(distinct wallet) as players, round(avg(score), 1) as avg_score, max(score) as best_score, max(at) as last_at
    from chain_scores where at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC' group by game_type
  ), s as (
    select game, count(*) as started, count(*) filter (where used) as completed, count(*) filter (where not used) as abandoned
    from game_sessions where started_at >= from_day::timestamp at time zone 'UTC' and started_at < (to_day + 1)::timestamp at time zone 'UTC' group by game
  )
  select coalesce(c.game, s.game), coalesce(c.played, 0), coalesce(c.players, 0), c.avg_score, c.best_score, coalesce(s.started, 0), coalesce(s.completed, 0), coalesce(s.abandoned, 0), c.last_at
  from c full outer join s on s.game = c.game order by 2 desc, 6 desc;
$$;

drop function if exists admin_top_players(date, date, integer);
create or replace function admin_top_players(from_day date, to_day date, lim int default 25)
returns table (wallet text, username text, games bigint, kinds bigint, days bigint, best numeric, last_at timestamptz, verified boolean) language sql stable as $$
  select s.wallet, m.username, count(*), count(distinct s.game_type), count(distinct (s.at at time zone 'UTC')::date), max(s.score), max(s.at), v.verified
  from chain_scores s left join chain_mints m on m.wallet = s.wallet left join verification_status v on v.wallet = s.wallet
  where s.at >= from_day::timestamp at time zone 'UTC' and s.at < (to_day + 1)::timestamp at time zone 'UTC'
  group by s.wallet, m.username, v.verified order by 3 desc limit greatest(1, least(lim, 200));
$$;

-- who is new: every wallet first seen in the period, by name, with what they did since
create or replace function admin_new_players(from_day date, to_day date, lim int default 100)
returns table (wallet text, username text, first_at timestamptz, minted_at timestamptz, verified boolean, games bigint, first_game text, last_at timestamptz, came_back boolean)
language sql stable as $$
  select f.wallet, m.username, f.first_at, m.at, v.verified,
         (select count(*) from chain_scores s where s.wallet = f.wallet),
         (select admin_game_name(s.game_type) from chain_scores s where s.wallet = f.wallet order by s.at limit 1),
         (select max(s.at) from chain_scores s where s.wallet = f.wallet),
         exists (select 1 from chain_scores s where s.wallet = f.wallet and (s.at at time zone 'UTC')::date > (f.first_at at time zone 'UTC')::date)
  from player_first_seen f left join chain_mints m on m.wallet = f.wallet left join verification_status v on v.wallet = f.wallet
  where f.first_at >= from_day::timestamp at time zone 'UTC' and f.first_at < (to_day + 1)::timestamp at time zone 'UTC'
  order by f.first_at desc limit greatest(1, least(lim, 500));
$$;

-- one page of everyone, by name. `q` matches the username or any part of the wallet.
drop function if exists admin_players(text, text, integer, integer);
create or replace function admin_players(q text default '', who text default 'all', sort text default 'recent', lim int default 25, off int default 0)
returns table (wallet text, username text, first_at timestamptz, last_at timestamptz, games bigint, kinds bigint, days bigint, best numeric, verified boolean, total bigint)
language sql stable as $$
  with base as (
    select f.wallet, m.username, f.first_at, v.verified
    from player_first_seen f left join chain_mints m on m.wallet = f.wallet left join verification_status v on v.wallet = f.wallet
    where (q = '' or f.wallet like '%' || lower(q) || '%' or lower(m.username) like '%' || lower(q) || '%')
      and (who = 'all' or (who = 'verified' and v.verified is true) or (who = 'unverified' and v.verified is not true)
           or (who = 'new7' and f.first_at >= now() - interval '7 days') or (who = 'new30' and f.first_at >= now() - interval '30 days'))
  ), agg as (
    select s.wallet, max(s.at) as last_at, count(*) as games, count(distinct s.game_type) as kinds, count(distinct (s.at at time zone 'UTC')::date) as days, max(s.score) as best
    from chain_scores s where s.wallet in (select wallet from base) group by s.wallet
  )
  select b.wallet, b.username, b.first_at, a.last_at, coalesce(a.games, 0), coalesce(a.kinds, 0), coalesce(a.days, 0), a.best, b.verified, (select count(*) from base)
  from base b left join agg a on a.wallet = b.wallet
  order by case when sort = 'games' then coalesce(a.games, 0) end desc nulls last,
           case when sort = 'new' then b.first_at end desc nulls last,
           a.last_at desc nulls last, b.first_at desc
  limit greatest(1, least(lim, 200)) offset greatest(off, 0);
$$;

create or replace function admin_player(w text) returns jsonb language plpgsql stable as $$
declare o jsonb := jsonb_build_object('wallet', lower(w)); j jsonb;
begin
  select to_jsonb(m) into j from chain_mints m where m.wallet = lower(w); o := o || jsonb_build_object('mint', j);
  begin select to_jsonb(u) into j from users u where lower(u.wallet_address) = lower(w); o := o || jsonb_build_object('user', j); exception when undefined_table or undefined_column then null; end;
  select to_jsonb(f) into j from player_first_seen f where f.wallet = lower(w); o := o || jsonb_build_object('first_seen', j);
  select to_jsonb(v) into j from verification_status v where v.wallet = lower(w); o := o || jsonb_build_object('verification', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select admin_game_name(game_type) as game, count(*) as games, max(score) as best, round(avg(score), 1) as avg, min(at) as first_at, max(at) as last_at
    from chain_scores where wallet = lower(w) group by game_type order by 2 desc) x;
  o := o || jsonb_build_object('games', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select at, admin_game_name(game_type) as game, score, tx_hash from chain_scores where wallet = lower(w) order by at desc limit 80) x;
  o := o || jsonb_build_object('recent_scores', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select (at at time zone 'UTC')::date as day, count(*) as games from chain_scores where wallet = lower(w) and at >= now() - interval '120 days' group by 1 order by 1) x;
  o := o || jsonb_build_object('by_day', j);
  select jsonb_build_object('started', count(*), 'abandoned', count(*) filter (where not used)) into j from game_sessions where lower(wallet) = lower(w);
  o := o || jsonb_build_object('tickets', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select * from payouts where lower(wallet) = lower(w) order by created_at desc limit 100) x;
  o := o || jsonb_build_object('payouts', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select at, kind, item, total, treasury, tx_hash from purchases where wallet = lower(w) order by at desc limit 60) x;
  o := o || jsonb_build_object('purchases', j);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (select at, kind, game, ref, tx_hash from platform_events where wallet = lower(w) order by at desc limit 50) x;
  o := o || jsonb_build_object('events', j);
  return o;
end $$;

drop function if exists admin_feed(integer, timestamptz, text);
create or replace function admin_feed(lim int default 60, before timestamptz default null, only_kind text default null)
returns table (at timestamptz, kind text, wallet text, username text, game text, detail text, tx_hash text) language plpgsql stable as $$
declare b timestamptz := coalesce(before, now() + interval '1 minute'); l int := greatest(1, least(lim, 300));
begin
  return query
  with parts as (
    (select s.at, 'game_completed'::text as kind, s.wallet, admin_game_name(s.game_type) as game, 'score ' || trim(to_char(s.score, 'FM999G999G999G990')) as detail, s.tx_hash
       from chain_scores s where s.at < b and (only_kind is null or only_kind = 'game_completed') order by s.at desc limit l)
    union all
    (select g.started_at, 'game_started', lower(g.wallet), g.game, 'not finished', null from game_sessions g
       where not g.used and g.started_at < b and g.started_at < now() - interval '15 minutes' and (only_kind is null or only_kind = 'game_started') order by g.started_at desc limit l)
    union all
    (select m.at, 'registered', m.wallet, null, 'as @' || coalesce(m.username, '?'), m.tx_hash from chain_mints m where m.at < b and (only_kind is null or only_kind = 'registered') order by m.at desc limit l)
    union all
    (select coalesce(v.verified_at, v.first_verified_at), 'verified', v.wallet, null, null, null from verification_status v
       where coalesce(v.verified_at, v.first_verified_at) is not null and coalesce(v.verified_at, v.first_verified_at) < b and (only_kind is null or only_kind = 'verified') order by 1 desc limit l)
    union all
    (select p.at, 'purchase', p.wallet, null, rtrim(rtrim(to_char(p.total, 'FM999999990.99'), '0'), '.') || ' G$ · ' || p.kind || ' #' || p.item, p.tx_hash from purchases p where p.at < b and (only_kind is null or only_kind = 'purchase') order by p.at desc limit l)
    union all
    (select coalesce(p.paid_at, p.created_at), 'payout_' || p.status, lower(p.wallet), null, p.amount::text || ' ' || p.token || coalesce(' · ' || p.reason, ''), p.tx_hash
       from payouts p where coalesce(p.paid_at, p.created_at) < b and (only_kind is null or only_kind = 'payout') order by 1 desc limit l)
    union all
    (select e.at, e.kind, e.wallet, e.game, e.ref, e.tx_hash from platform_events e where e.at < b and e.kind not in ('verified', 'payout_recorded') and (only_kind is null or only_kind = e.kind) order by e.at desc limit l)
  )
  select p.at, p.kind, p.wallet, m.username, p.game, p.detail, p.tx_hash from parts p left join chain_mints m on m.wallet = p.wallet order by p.at desc limit l;
end $$;

-- retention, from every recorded score and run ticket
create or replace function admin_retention(weeks int default 8) returns table (cohort date, cohort_size bigint, week_offset int, players bigint) language sql stable as $$
  with lim as (select date_trunc('week', now() at time zone 'UTC') - make_interval(weeks => greatest(1, least(weeks, 26))) as t),
  coh as (select wallet, date_trunc('week', first_at at time zone 'UTC')::date as cohort from player_first_seen, lim where first_at at time zone 'UTC' >= lim.t),
  act as (
    select distinct wallet, date_trunc('week', at at time zone 'UTC')::date as wk from chain_scores, lim where at at time zone 'UTC' >= lim.t
    union select distinct lower(wallet), date_trunc('week', started_at at time zone 'UTC')::date from game_sessions, lim where started_at at time zone 'UTC' >= lim.t
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
    'verified_played', (select count(*) from verification_status v where v.verified and exists (select 1 from chain_scores s where s.wallet = v.wallet)),
    'verified_never_played', (select count(*) from verification_status v where v.verified and not exists (select 1 from chain_scores s where s.wallet = v.wallet)),
    'last_checked', (select max(checked_at) from verification_status),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
       select v.wallet, m.username, coalesce(v.verified_at, v.first_verified_at) as at, (select count(*) from chain_scores s where s.wallet = v.wallet) as games
       from verification_status v left join chain_mints m on m.wallet = v.wallet where v.verified order by coalesce(v.verified_at, v.first_verified_at) desc nulls last limit 40) x),
    'never_played', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
       select v.wallet, m.username, coalesce(v.verified_at, v.first_verified_at) as at from verification_status v left join chain_mints m on m.wallet = v.wallet
       where v.verified and not exists (select 1 from chain_scores s where s.wallet = v.wallet) order by 3 desc nulls last limit 40) x)
  );
$$;

create or replace function admin_verify_queue(lim int default 30) returns table (wallet text) language sql stable as $$
  select f.wallet from player_first_seen f left join verification_status v on v.wallet = f.wallet
  order by v.checked_at asc nulls first limit greatest(1, least(lim, 200));
$$;

-- record one check. `chain_date` is the date on the GoodDollar contract (unix seconds), when it gave one.
drop function if exists admin_set_verified(text, boolean);
create or replace function admin_set_verified(w text, is_verified boolean, chain_date bigint default null) returns boolean language plpgsql as $$
declare was boolean; d timestamptz := case when chain_date is not null and chain_date > 0 then to_timestamp(chain_date) end;
begin
  select verified into was from verification_status where wallet = lower(w);
  insert into verification_status (wallet, verified, first_verified_at, verified_at, checked_at)
  values (lower(w), is_verified, case when is_verified then now() end, case when is_verified then d end, now())
  on conflict (wallet) do update set verified = excluded.verified, checked_at = now(),
    first_verified_at = coalesce(verification_status.first_verified_at, case when excluded.verified then now() end),
    verified_at = coalesce(case when excluded.verified then excluded.verified_at end, verification_status.verified_at);
  if is_verified and was is not true then
    insert into platform_events (kind, wallet) values ('verified', lower(w));
    return true;
  end if;
  return false;
end $$;

-- ── verification, in full ────────────────────────────────────────────────────
-- GoodDollar verification is not yes or no. A wallet can be verified now,
-- LAPSED (it passed the face check once and the window ran out: 3 days the
-- first time, 180 after that, repeating), never verified, or blacklisted. It
-- can also be verified through a linked wallet rather than by itself. The
-- backend reads all of that from the Identity contract.
alter table verification_status add column if not exists state text;            -- verified | lapsed | none | blacklisted
alter table verification_status add column if not exists self_verified boolean; -- this wallet itself is whitelisted (the payout gate uses this, not `verified`)
alter table verification_status add column if not exists root text;             -- the verified wallet this one is linked to, when it is not itself
alter table verification_status add column if not exists auth_at timestamptz;   -- last passed the face check
alter table verification_status add column if not exists expires_at timestamptz;
alter table verification_status add column if not exists probation boolean;     -- on the short 3-day window

create or replace function admin_set_identity(w text, st text, is_self boolean, via text, added bigint, authed bigint, expires bigint, on_probation boolean) returns boolean language plpgsql as $$
declare was text; is_v boolean := st = 'verified';
  d_added timestamptz := case when added is not null and added > 0 then to_timestamp(added) end;
  d_auth timestamptz := case when authed is not null and authed > 0 then to_timestamp(authed) end;
begin
  select state into was from verification_status where wallet = lower(w);
  insert into verification_status (wallet, verified, state, self_verified, root, verified_at, auth_at, expires_at, probation, first_verified_at, checked_at)
  values (lower(w), is_v, st, is_self, nullif(lower(via), ''), coalesce(d_added, d_auth), d_auth, case when expires is not null and expires > 0 then to_timestamp(expires) end, on_probation, case when is_v then now() end, now())
  on conflict (wallet) do update set verified = excluded.verified, state = excluded.state, self_verified = excluded.self_verified, root = excluded.root,
    verified_at = coalesce(excluded.verified_at, verification_status.verified_at), auth_at = coalesce(excluded.auth_at, verification_status.auth_at),
    expires_at = excluded.expires_at, probation = excluded.probation, checked_at = now(),
    first_verified_at = coalesce(verification_status.first_verified_at, case when excluded.verified then now() end);
  if st is distinct from was and st in ('verified', 'lapsed') and was is not null then
    insert into platform_events (kind, wallet, ref) values (case when st = 'verified' then 'verified' else 'verification_lapsed' end, lower(w), 'was ' || was);
  end if;
  return is_v and was is distinct from 'verified';
end $$;

create or replace function admin_verification() returns jsonb language sql stable as $$
  with v as (select s.*, m.username, (select count(*) from chain_scores c where c.wallet = s.wallet) as games from verification_status s left join chain_mints m on m.wallet = s.wallet where s.checked_at is not null)
  select jsonb_build_object(
    'verified', (select count(*) from v where verified),
    'lapsed', (select count(*) from v where state = 'lapsed'),
    'never', (select count(*) from v where state = 'none' or (state is null and not verified)),
    'blacklisted', (select count(*) from v where state = 'blacklisted'),
    'unverified', (select count(*) from v where not verified),
    'via_linked', (select count(*) from v where verified and self_verified is false),
    'on_probation', (select count(*) from v where verified and probation),
    'expiring_14d', (select count(*) from v where verified and expires_at is not null and expires_at < now() + interval '14 days'),
    'not_checked_yet', (select count(*) from player_first_seen f where not exists (select 1 from verification_status s where s.wallet = f.wallet and s.checked_at is not null)),
    'verified_played', (select count(*) from v where verified and games > 0),
    'verified_never_played', (select count(*) from v where verified and games = 0),
    'last_checked', (select max(checked_at) from v),
    'recent', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select wallet, username, coalesce(auth_at, verified_at, first_verified_at) as at, games, self_verified, expires_at from v where verified order by 3 desc nulls last limit 40) x),
    'expiring', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select wallet, username, expires_at as at, games, probation from v where verified and expires_at is not null and expires_at < now() + interval '14 days' order by expires_at limit 40) x),
    'lapsed_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select wallet, username, coalesce(expires_at, auth_at) as at, games from v where state = 'lapsed' order by games desc, 3 desc nulls last limit 60) x),
    'never_played', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select wallet, username, coalesce(auth_at, verified_at, first_verified_at) as at from v where verified and games = 0 order by 3 desc nulls last limit 40) x)
  );
$$;

-- the players list can now be narrowed to lapsed players too, and carries each one's state
drop function if exists admin_players(text, text, text, integer, integer);
create or replace function admin_players(q text default '', who text default 'all', sort text default 'recent', lim int default 25, off int default 0)
returns table (wallet text, username text, first_at timestamptz, last_at timestamptz, games bigint, kinds bigint, days bigint, best numeric, verified boolean, state text, total bigint)
language sql stable as $$
  with base as (
    select f.wallet, m.username, f.first_at, v.verified, v.state
    from player_first_seen f left join chain_mints m on m.wallet = f.wallet left join verification_status v on v.wallet = f.wallet
    where (q = '' or f.wallet like '%' || lower(q) || '%' or lower(m.username) like '%' || lower(q) || '%')
      and (who = 'all' or (who = 'verified' and v.verified is true) or (who = 'unverified' and v.verified is not true) or (who = 'lapsed' and v.state = 'lapsed')
           or (who = 'new7' and f.first_at >= now() - interval '7 days') or (who = 'new30' and f.first_at >= now() - interval '30 days'))
  ), agg as (
    select s.wallet, max(s.at) as last_at, count(*) as games, count(distinct s.game_type) as kinds, count(distinct (s.at at time zone 'UTC')::date) as days, max(s.score) as best
    from chain_scores s where s.wallet in (select wallet from base) group by s.wallet
  )
  select b.wallet, b.username, b.first_at, a.last_at, coalesce(a.games, 0), coalesce(a.kinds, 0), coalesce(a.days, 0), a.best, b.verified, b.state, (select count(*) from base)
  from base b left join agg a on a.wallet = b.wallet
  order by case when sort = 'games' then coalesce(a.games, 0) end desc nulls last,
           case when sort = 'new' then b.first_at end desc nulls last,
           a.last_at desc nulls last, b.first_at desc
  limit greatest(1, least(lim, 200)) offset greatest(off, 0);
$$;
