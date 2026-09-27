-- Persisted tug team assignments.
-- Run once in the Supabase SQL editor. Safe to re-run.
create table if not exists tug_team (
  wallet        text not null,
  identity_root text,
  team          text not null check (team in ('red','blue')),
  event_id      text not null default 'tug-1',
  assigned_at   timestamptz not null default now(),
  primary key (wallet, event_id)
);

alter table tug_team enable row level security;

-- The backend uses the anon key; allow it to read all rows and insert new ones.
-- No update/delete policy: a team, once written, is immutable.
drop policy if exists tug_team_read on tug_team;
create policy tug_team_read on tug_team for select using (true);

drop policy if exists tug_team_insert on tug_team;
create policy tug_team_insert on tug_team for insert with check (true);
