-- 2026-11-26 · Friends. Run once in the Supabase SQL editor. Safe to run again.
--
-- One row per pair of players. The lower address is always `a`, so the same
-- two players can never be recorded twice. `asked_by` is who sent the request;
-- the other player accepts it. A removed friendship is a deleted row.

create table if not exists friendships (
  a           text        not null,
  b           text        not null,
  status      text        not null default 'pending',
  asked_by    text        not null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  constraint friendships_order   check (a < b),
  constraint friendships_status  check (status in ('pending', 'accepted')),
  constraint friendships_asker   check (asked_by = a or asked_by = b),
  constraint friendships_wallets check (a ~ '^0x[a-f0-9]{40}$' and b ~ '^0x[a-f0-9]{40}$'),
  constraint friendships_accept  check ((status = 'accepted') = (accepted_at is not null))
);
-- "everyone I am paired with" is asked from both sides
create index if not exists friendships_b_idx on friendships (b);

-- Only the server reads or writes this table.
alter table friendships enable row level security;
