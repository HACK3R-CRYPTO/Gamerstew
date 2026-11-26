-- 2026-11-27 · Streak freeze, and locking this week's money functions to the server.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- A streak freeze is a shop item (11) a player holds in perk_inventory. When they
-- come back after a missed day, the server spends one for each day missed and the
-- streak carries on (games-backend/src/modules/progression/streak.ts).

-- Spend `n` freezes, only if the player holds that many. One statement, so two
-- games finishing together cannot both spend the same freeze.
create or replace function streak_freeze_use(w text, item integer, n integer) returns boolean language plpgsql as $$
begin
  if n is null or n <= 0 then return false; end if;
  update perk_inventory set balance = balance - n, updated_at = now() where wallet = w and perk_id = item and balance >= n;
  return found;
end $$;

-- For the admin dashboard: freezes used (each is a message in the player's inbox) and freezes still held.
create or replace function admin_freezes(from_day date, to_day date) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'saved', (select count(*) from notifications_feed where category = 'streak_freeze' and sent_at >= from_day::timestamp at time zone 'UTC' and sent_at < (to_day + 1)::timestamp at time zone 'UTC'),
    'players_saved', (select count(distinct wallet_address) from notifications_feed where category = 'streak_freeze' and sent_at >= from_day::timestamp at time zone 'UTC' and sent_at < (to_day + 1)::timestamp at time zone 'UTC'),
    'held', (select coalesce(sum(balance), 0) from perk_inventory where perk_id = 11 and balance > 0),
    'holders', (select count(*) from perk_inventory where perk_id = 11 and balance > 0)
  );
$$;

-- These functions give out or spend things players pay for. Only the server may call them.
do $$
declare f text;
begin
  foreach f in array array[
    'streak_freeze_use(text, integer, integer)', 'energy_take(text, date, integer, integer)', 'energy_give_back(text, date, boolean, integer)',
    'energy_add(text, integer, integer)', 'energy_state(text, date, integer)', 'pot_close(jsonb, jsonb)'
  ] loop
    begin
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    exception when undefined_function then null; -- that migration has not been run here yet
              when undefined_object then null;   -- a database without Supabase's roles (a local test one)
    end;
  end loop;
end $$;
