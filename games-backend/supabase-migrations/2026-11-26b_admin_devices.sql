-- 2026-11-26 · Devices report for the admin dashboard. Run once in the Supabase
-- SQL editor. Safe to run again.
--
-- A 3D game reports once per visit what device it ran on and how it ran: the
-- graphics chip, the level it started at, the level it settled at, and the
-- frame rate it got (site_events, kind 'device_profile'). Nothing here names a
-- person. This turns those rows into the report: which chips players have, how
-- each ran, and how many visits ran badly.

create or replace function admin_devices(from_day date, to_day date) returns jsonb language sql stable as $$
  with e as (
    select anon_id,
           coalesce(nullif(props->>'chip', ''), 'unknown') as chip,
           coalesce(nullif(props->>'gpu', ''), 'not named by the browser') as gpu,
           coalesce(props->>'game', '') as game,
           coalesce(device, 'unknown') as device,
           nullif(props->>'got_fps', '')::numeric as fps,
           nullif(props->>'settled_dpr', '')::numeric as dpr,
           nullif(props->>'memory', '')::numeric as memory,
           coalesce(props->>'choice', 'auto') as choice
    from site_events
    where kind = 'device_profile' and at >= from_day::timestamp at time zone 'UTC' and at < (to_day + 1)::timestamp at time zone 'UTC'
  )
  select jsonb_build_object(
    'visits', (select count(*) from e),
    'visitors', (select count(distinct anon_id) from e),
    -- under 24 frames a second is where a 3D game stops feeling playable
    'slow', (select count(*) from e where fps < 24),
    'smooth', (select count(*) from e where fps >= 50),
    'chips', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select chip, count(*) as visits, count(distinct anon_id) as visitors, round(avg(fps)) as fps, round(avg(dpr), 2) as dpr, count(*) filter (where fps < 24) as slow
      from e group by chip order by count(*) desc) x),
    'phones', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select gpu, chip, count(*) as visits, count(distinct anon_id) as visitors, round(avg(fps)) as fps, round(min(fps)) as worst, round(avg(dpr), 2) as dpr, round(avg(memory)) as memory
      from e group by gpu, chip order by count(*) desc limit 40) x),
    'games', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select game, count(*) as visits, round(avg(fps)) as fps, count(*) filter (where fps < 24) as slow from e where game <> '' group by game order by count(*) desc) x),
    'choices', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select choice, count(distinct anon_id) as visitors from e group by choice order by 2 desc) x)
  );
$$;
