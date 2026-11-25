-- 2026-11-27 · The daily pot. Run once in the Supabase SQL editor. Safe to run again.
--
-- One game a day carries a pot: a share of what players spent on energy that
-- day, plus a seed, plus whatever an unpaid day rolled forward. When the day
-- ends the top third of players split it. See docs/business-model.md and
-- games-backend/src/modules/pot.
--
-- Nothing here holds or moves money. pot_days is the record of each closed day.
-- A prize is written to `payouts` as PENDING, the same ledger the weekly prizes
-- use, and is paid by the owner like any other prize.

create table if not exists pot_days (
  day         date primary key,
  game        text not null,
  spend       numeric not null default 0,   -- G$ players spent on energy that day
  seed        numeric not null default 0,   -- G$ the treasury put in
  carried_in  numeric not null default 0,   -- G$ rolled in from the day before
  pot         numeric not null default 0,   -- what was played for
  players     integer not null default 0,   -- verified players with a confirmed score
  winners     integer not null default 0,
  status      text not null check (status in ('paid', 'rolled')),
  carried_out numeric not null default 0,   -- G$ rolled into the next day
  settled_at  timestamptz not null default now()
);
alter table pot_days enable row level security;
alter table payouts add column if not exists pot_day date;
create index if not exists payouts_pot_day on payouts (pot_day) where pot_day is not null;

-- G$ spent on energy on a UTC day, as the chain reader recorded it.
create or replace function pot_spend(d date, energy_item integer) returns numeric language sql stable as $$
  select coalesce(sum(total), 0) from purchases
  where kind = 'perk' and item = energy_item and at >= d::timestamp at time zone 'UTC' and at < (d + 1)::timestamp at time zone 'UTC';
$$;

-- Who is in a day's pot: each VERIFIED player's best score in the game of the day,
-- counting only runs whose score is confirmed (it has its transaction). One row a player.
create or replace function pot_entries(d date, g text) returns table (wallet text, score integer, at timestamptz) language sql stable as $$
  select distinct on (lower(s.wallet)) lower(s.wallet), s.computed_score, coalesce(s.used_at, s.started_at)
  from game_sessions s
  join verification_status v on lower(v.wallet) = lower(s.wallet) and v.verified
  where s.game = g and s.used and s.tx_hash is not null and s.computed_score > 0
    and s.started_at >= d::timestamp at time zone 'UTC' and s.started_at < (d + 1)::timestamp at time zone 'UTC'
  order by lower(s.wallet), s.computed_score desc, coalesce(s.used_at, s.started_at) asc;
$$;

-- Close a day: the day's row and its pending prizes, together or not at all, and only once.
create or replace function pot_close("row" jsonb, payouts jsonb) returns boolean language plpgsql as $$
declare d date := ("row"->>'day')::date; p jsonb;
begin
  insert into pot_days (day, game, spend, seed, carried_in, pot, players, winners, status, carried_out)
  values (d, "row"->>'game', ("row"->>'spend')::numeric, ("row"->>'seed')::numeric, ("row"->>'carried_in')::numeric, ("row"->>'pot')::numeric,
          ("row"->>'players')::integer, ("row"->>'winners')::integer, "row"->>'status', ("row"->>'carried_out')::numeric)
  on conflict (day) do nothing;
  if not found then return false; end if;
  for p in select * from jsonb_array_elements(coalesce(payouts, '[]'::jsonb)) loop
    insert into payouts (wallet, amount, token, reason, status, note, recorded_by, pot_day)
    values (lower(p->>'wallet'), (p->>'amount')::numeric, 'G$', p->>'reason', 'pending', 'Daily pot. Worked out by the server from confirmed scores.', 'pot', d);
  end loop;
  return true;
end $$;

-- For the admin dashboard: the pots closed in a range, and what is still owed.
create or replace function admin_pot(from_day date, to_day date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'days', (select coalesce(jsonb_agg(x order by x.day desc), '[]'::jsonb) from (
      select to_char(day, 'YYYY-MM-DD') as day, game, spend, seed, carried_in, pot, players, winners, status, carried_out from pot_days where day >= from_day and day <= to_day) x),
    'paid_out', (select coalesce(sum(pot), 0) from pot_days where status = 'paid' and day >= from_day and day <= to_day),
    'energy_spend', (select coalesce(sum(spend), 0) from pot_days where day >= from_day and day <= to_day),
    'owed', (select coalesce(sum(amount), 0) from payouts where pot_day is not null and status = 'pending'),
    'owed_to', (select count(distinct wallet) from payouts where pot_day is not null and status = 'pending'),
    'prizes', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select to_char(pot_day, 'YYYY-MM-DD') as day, wallet, amount, reason, status, tx_hash from payouts where pot_day is not null and pot_day >= from_day and pot_day <= to_day order by pot_day desc, amount desc limit 200) x)
  );
$$;
