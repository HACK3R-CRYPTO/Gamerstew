-- 2026-11-27 · Energy: how many ranked runs a player may start in a day. Run once
-- in the Supabase SQL editor. Safe to run again. Nothing reads it until
-- ENERGY_ENABLED is set to "true" on the server.
--
-- A number of free runs each UTC day, then runs bought in the shop. Bought runs
-- are kept in perk_inventory under the energy item's id and do not expire.

create table if not exists energy_days (
  wallet text not null,
  day    date not null,
  used   integer not null default 0,   -- free runs taken that day
  paid   integer not null default 0,   -- bought runs spent that day
  primary key (wallet, day)
);
alter table energy_days enable row level security;

-- Take one run. Each branch is a single UPDATE with its own condition, so two
-- requests arriving together cannot both take the last free run or the last bought one.
create or replace function energy_take(w text, d date, free_plays integer, item integer) returns jsonb language plpgsql as $$
declare u integer; b integer;
begin
  insert into energy_days (wallet, day) values (w, d) on conflict do nothing;
  update energy_days set used = used + 1 where wallet = w and day = d and used < free_plays returning used into u;
  if found then
    select balance into b from perk_inventory where wallet = w and perk_id = item;
    return jsonb_build_object('ok', true, 'paid', false, 'used', u, 'bought', coalesce(b, 0));
  end if;
  update perk_inventory set balance = balance - 1, updated_at = now() where wallet = w and perk_id = item and balance > 0 returning balance into b;
  if found then
    update energy_days set paid = paid + 1 where wallet = w and day = d;
    return jsonb_build_object('ok', true, 'paid', true, 'used', free_plays, 'bought', b);
  end if;
  return jsonb_build_object('ok', false, 'paid', false, 'used', free_plays, 'bought', 0);
end $$;

create or replace function energy_give_back(w text, d date, was_paid boolean, item integer) returns void language plpgsql as $$
begin
  if was_paid then
    update perk_inventory set balance = balance + 1, updated_at = now() where wallet = w and perk_id = item;
    update energy_days set paid = greatest(0, paid - 1) where wallet = w and day = d;
  else
    update energy_days set used = greatest(0, used - 1) where wallet = w and day = d;
  end if;
end $$;

create or replace function energy_state(w text, d date, item integer) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'used', coalesce((select used from energy_days where wallet = w and day = d), 0),
    'bought', coalesce((select balance from perk_inventory where wallet = w and perk_id = item), 0));
$$;

create or replace function energy_add(w text, item integer, plays integer) returns integer language plpgsql as $$
declare b integer;
begin
  insert into perk_inventory (wallet, perk_id, balance, updated_at) values (w, item, plays, now())
  on conflict (wallet, perk_id) do update set balance = perk_inventory.balance + excluded.balance, updated_at = now()
  returning balance into b;
  return b;
end $$;
