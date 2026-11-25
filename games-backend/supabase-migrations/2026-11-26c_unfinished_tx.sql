-- 2026-11-26 · The dashboard's activity feed shows the transaction of an
-- unfinished run. Run once in the Supabase SQL editor. Safe to run again.
--
-- A run that was started and never finished now gets a transaction of its own
-- (a note, not a score: see games-backend/src/modules/scores/unfinished.ts).
-- The server writes its hash on the run's row. The feed used to show "–" for
-- these rows; this is the same function with that one column filled in.

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
    (select g.started_at, 'game_started', lower(g.wallet), g.game, 'not finished', g.tx_hash from game_sessions g
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
