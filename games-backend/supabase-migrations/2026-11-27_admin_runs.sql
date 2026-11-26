-- 2026-11-27 · "Runs" report for the admin dashboard. Run once in the Supabase
-- SQL editor. Safe to run again.
--
-- What happens to a run after it starts, by game: finished, left unfinished
-- (and whether its transaction was sent), ended early by the player. What a
-- continue does: how often it is offered, bought and turned down. How the pets
-- feel today. What the shop sold, item by item.
--
-- Sources: game_sessions (the server's own record of every run that was
-- opened), purchases (read from the chain by our own reader), users (streaks),
-- and site_events for the three things only the page knows: a quit, a continue
-- offered, a pet poked.

create or replace function admin_runs(from_day date, to_day date) returns jsonb language sql stable as $$
  with s as (
    select game, lower(wallet) as wallet, used, computed_score as score, tx_hash, started_at,
           (not used and started_at < now() - interval '15 minutes') as unfinished
    from game_sessions
    where started_at >= from_day::timestamp at time zone 'UTC' and started_at < (to_day + 1)::timestamp at time zone 'UTC'
  ), ev as (
    select kind, anon_id, coalesce(nullif(props->>'game', ''), 'unknown') as game, props
    from site_events
    where kind in ('run_quit', 'continue_offer', 'continue_bought', 'continue_declined', 'pet_poke')
      and at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC'
  ), shop as (
    select item, count(*) as sold, count(distinct wallet) as buyers, coalesce(sum(total), 0) as total, coalesce(sum(treasury), 0) as treasury, coalesce(sum(ubi), 0) as ubi
    from purchases
    where kind = 'perk' and at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC'
    group by item
  ), u as (
    select case when last_play_date::text = to_char(now() at time zone 'UTC', 'YYYY-MM-DD') then 'happy'
                when coalesce(play_streak, 0) > 0 then 'sad' else 'sleepy' end as mood,
           (last_play_date::text = to_char((now() at time zone 'UTC') - interval '1 day', 'YYYY-MM-DD') and coalesce(play_streak, 0) > 0) as breaks_today
    from users
  )
  select jsonb_build_object(
    'started', (select count(*) from s),
    'finished', (select count(*) from s where used),
    'unfinished', (select count(*) from s where unfinished),
    'unfinished_onchain', (select count(*) from s where not used and tx_hash is not null),
    'players', (select count(distinct wallet) from s),
    'games', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select game, count(*) as started, count(*) filter (where used) as finished, count(*) filter (where unfinished) as unfinished,
             count(*) filter (where not used and tx_hash is not null) as unfinished_onchain, count(distinct wallet) as players,
             max(score) filter (where used) as best, round(avg(score) filter (where used)) as average
      from s group by game order by count(*) desc) x),
    'days', (select coalesce(jsonb_agg(x order by x.day), '[]'::jsonb) from (
      select to_char(started_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as started, count(*) filter (where used) as finished,
             count(*) filter (where not used and tx_hash is not null) as unfinished_onchain
      from s group by 1) x),
    -- Word Ladder had a ceiling of 100 a round until 2026-11-27. Scores above it show the timed round at work.
    'ladder', (select jsonb_build_object('rounds', count(*), 'over_100', count(*) filter (where score > 100), 'best', max(score), 'average', round(avg(score)))
               from s where game = 'ladder' and used),
    'quits', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select game, count(*) as quits, count(*) filter (where props->>'saved' = 'true') as saved, count(distinct anon_id) as players
      from ev where kind = 'run_quit' group by game order by count(*) desc) x),
    'continues', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select game, count(*) filter (where kind = 'continue_offer') as offered, count(*) filter (where kind = 'continue_bought') as bought,
             count(*) filter (where kind = 'continue_declined') as declined,
             count(*) filter (where kind = 'continue_bought' and props->>'ranked' = 'true') as bought_ranked,
             count(distinct anon_id) filter (where kind = 'continue_bought') as buyers
      from ev where kind like 'continue_%' group by game order by 2 desc) x),
    'pokes', (select jsonb_build_object('times', count(*), 'players', count(distinct anon_id)) from ev where kind = 'pet_poke'),
    'moods', (select jsonb_build_object('happy', count(*) filter (where mood = 'happy'), 'sad', count(*) filter (where mood = 'sad'),
                                        'sleepy', count(*) filter (where mood = 'sleepy'), 'breaks_today', count(*) filter (where breaks_today)) from u),
    'shop', (select coalesce(jsonb_agg(x order by x.item), '[]'::jsonb) from shop x)
  );
$$;
