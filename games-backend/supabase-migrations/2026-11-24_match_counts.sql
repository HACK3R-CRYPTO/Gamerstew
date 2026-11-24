-- 2026-11-24 · Count Challenge AI matches in the database, not on the server.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- Two pages (the Challenge AI ranking and the MARKOV Climb board) used to read
-- up to 5,000 match rows each time, only to count them per player. That is
-- about 400 KB sent out of the database per refresh, for an answer that fits in
-- 2 KB. This function does the counting where the rows are and sends back only
-- the top players.
--
-- Until this is run, both pages fall back to the old way and still work.

create or replace function agent_match_counts(p_from timestamptz default null, p_to timestamptz default null, p_limit int default 50)
returns table (challenger text, matches bigint, wins bigint, ties bigint)
language sql stable as $$
  select lower(m.challenger) as challenger,
         count(*) as matches,
         count(*) filter (where m.outcome = 'player_won') as wins,
         count(*) filter (where m.outcome = 'tie') as ties
  from agent_match_state m
  where m.resolved_at is not null and m.challenger is not null
    and (p_from is null or m.resolved_at >= p_from)
    and (p_to is null or m.resolved_at <= p_to)
  group by lower(m.challenger)
  order by count(*) desc, count(*) filter (where m.outcome = 'player_won') desc
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function agent_match_counts(timestamptz, timestamptz, int) to anon, authenticated, service_role;

-- the count scans by time; this keeps it quick as the table grows
create index if not exists agent_match_state_resolved_idx on agent_match_state (resolved_at) where resolved_at is not null;
