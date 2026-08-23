-- Duel Rooms — off-chain mirror of the DuelEscrow contract.
-- The contract is the source of truth for funds, membership, and resolution.
-- These tables are a fast, queryable mirror so the hub can list public rooms,
-- filter out private ones, and show live state without hammering the chain.
-- Every row is reconciled against on-chain reads (getRoom / getPlayers); nothing
-- here moves money.

create table if not exists duel_rooms (
  id            bigint primary key,              -- on-chain roomId
  creator       text        not null,
  game_type     smallint    not null,            -- on-chain representative game
  games         smallint[],                      -- full set of games the room spans (off-chain)
  visibility    text        not null,            -- 'public' | 'private'
  gating        text        not null default 'open', -- 'open' | 'code' | 'allowlist'
  stake_wei     numeric     not null default 0,
  seed_wei      numeric     not null default 0,
  fee_bps       integer     not null default 0,  -- 0 for sponsored pools
  capacity      integer     not null,
  starts_at     timestamptz,                     -- when scoring opens (off-chain; null = at creation)
  deadline      timestamptz not null,
  status        text        not null default 'open', -- 'open' | 'resolved' | 'refunded'
  winner        text,                            -- filled on resolve
  create_tx     text,
  resolve_tx    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Hub query: public, still open, not past deadline. Kept fast.
create index if not exists duel_rooms_hub_idx
  on duel_rooms (visibility, status, deadline);
create index if not exists duel_rooms_creator_idx on duel_rooms (creator);

create table if not exists duel_participants (
  room_id    bigint      not null references duel_rooms(id) on delete cascade,
  wallet     text        not null,
  joined_at  timestamptz not null default now(),
  score      bigint,                             -- best validated run for this duel; filled before resolve
  join_index integer,                            -- position in the on-chain players[] (aligns the scoreboard)
  primary key (room_id, wallet)
);
create index if not exists duel_participants_wallet_idx on duel_participants (wallet);

-- The allowlist mirror (source of truth is on-chain `allowlisted`), so the admin
-- panel and the join UI can show who is approved without a chain read per wallet.
create table if not exists duel_allowlist (
  room_id  bigint not null references duel_rooms(id) on delete cascade,
  wallet   text   not null,
  added_at timestamptz not null default now(),
  primary key (room_id, wallet)
);

-- Persistent head-to-head rivalry record (the retention engine). Ordered pair:
-- wallet_lo < wallet_hi so each pair has exactly one row; wins are attributed by
-- comparing the winner to the two columns.
create table if not exists duel_rivalries (
  wallet_lo   text not null,
  wallet_hi   text not null,
  wins_lo     integer not null default 0,
  wins_hi     integer not null default 0,
  ties        integer not null default 0,
  last_room   bigint,
  last_played timestamptz not null default now(),
  primary key (wallet_lo, wallet_hi)
);
