-- 2026-11-24 · Run this once in the Supabase SQL editor. Safe to run again.
--
-- PART 1 fixes a live bug. PARTS 2 and 3 are for speed at scale.
--
-- ── PART 1 · let the three new games save ───────────────────────────────────
-- game_sessions only allowed ('rhythm','simon','stack','nepa'). Starting a
-- ranked round of Word Ladder, Street Strike or UP NEPA 3D tried to insert a
-- row with a new name, the check refused it, and /api/start-game answered 500.
-- The games then played unranked, so nothing reached the chain.
alter table game_sessions
  drop constraint if exists game_sessions_game_check;

alter table game_sessions
  add constraint game_sessions_game_check
  check (game in ('rhythm', 'simon', 'stack', 'nepa', 'ladder', 'strike', 'nepa3d'));

-- ── PART 2 · indexes for the boards and the weekly count ────────────────────
-- Both read "scored runs since a time". Without these, each read walks the
-- whole table, and the table grows by one row for every run ever played.
-- Partial (where used) because unscored tickets are never on a board.
create index if not exists idx_game_sessions_board
  on game_sessions (game, used_at desc)
  where used;

create index if not exists idx_game_sessions_scored_at
  on game_sessions (used_at)
  where used;

-- ── PART 3 · let the database do the adding up ──────────────────────────────
-- The server used to pull every row of the window (1,000 at a time) and work
-- out each player's best in JavaScript. These two functions do it inside the
-- database and return only the rows a page needs.

-- A game's board: each player's best scored run since p_since, best first.
-- `total` is the number of players on the whole board, repeated on every row.
create or replace function board_window(p_game text, p_since timestamptz, p_limit int, p_offset int)
returns table (wallet text, best integer, plays bigint, last_at timestamptz, total bigint)
language sql stable as $$
  with per_player as (
    select lower(s.wallet) as wallet, max(s.computed_score) as best, count(*) as plays, max(s.used_at) as last_at
    from game_sessions s
    where s.used and s.game = p_game and s.used_at >= p_since and s.computed_score is not null
    group by lower(s.wallet)
  )
  select p.wallet, p.best, p.plays, p.last_at, count(*) over () as total
  from per_player p
  order by p.best desc, p.last_at asc
  limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset);
$$;

-- Scored runs per player in a window, across every game (the weekly challenge).
create or replace function play_counts_window(p_start timestamptz, p_end timestamptz)
returns table (wallet text, plays bigint)
language sql stable as $$
  select lower(s.wallet) as wallet, count(*) as plays
  from game_sessions s
  where s.used and s.used_at >= p_start and s.used_at <= p_end
  group by lower(s.wallet);
$$;

-- ── PART 4 · the chain outbox (not used until SCORE_OUTBOX is switched on) ──
-- Scores wait here to be sent on-chain, so a player never waits on the chain
-- and a failed send never loses a score. `confirmed` is the only status prizes
-- may count. One row per session ticket, enforced here, not in code.
create table if not exists chain_outbox (
  id            bigint generated always as identity primary key,
  session_token text        not null unique,
  wallet        text        not null,
  game          text        not null,
  game_type     smallint    not null,
  score         integer     not null check (score >= 0),
  status        text        not null default 'pending' check (status in ('pending', 'sent', 'confirmed', 'failed')),
  attempts      integer     not null default 0,
  tx_hash       text,
  last_error    text,
  created_at    timestamptz not null default now(),
  next_try_at   timestamptz not null default now(),
  sent_at       timestamptz,
  confirmed_at  timestamptz,
  -- a row that says it was sent or confirmed must carry the transaction
  constraint chain_outbox_sent_has_hash check (status not in ('sent', 'confirmed') or tx_hash is not null)
);
create index if not exists idx_chain_outbox_due  on chain_outbox (next_try_at) where status = 'pending';
create index if not exists idx_chain_outbox_sent on chain_outbox (sent_at)     where status = 'sent';
create index if not exists idx_chain_outbox_wallet on chain_outbox (lower(wallet), created_at desc);

-- Take rows that are due and hold them, in one step, so two workers can never
-- take the same row. `skip locked` lets a second worker pass over rows the
-- first is holding instead of waiting on them.
create or replace function outbox_claim(p_limit int, p_lease_seconds int)
returns setof chain_outbox
language sql as $$
  update chain_outbox o
     set next_try_at = now() + make_interval(secs => p_lease_seconds), attempts = o.attempts + 1
   where o.id in (
     select id from chain_outbox
      where status = 'pending' and next_try_at <= now()
      order by next_try_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning o.*;
$$;
