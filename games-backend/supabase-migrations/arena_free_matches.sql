-- Arena Instant Match receipts (Challenge AI v3, free matches)
-- One row per completed best-of-5 match. Feeds:
--   · the weekly MARKOV ladder (points aggregation)
--   · match history / analytics
--   · the async Oracle 8004 attestor (match_completed feedback)

create table if not exists arena_free_matches (
  match_id     text primary key,          -- engine id, e.g. am_1eb98b2b88d7bccf
  wallet       text not null,             -- player wallet, lowercase
  player_wins  smallint not null,
  ai_wins      smallint not null,
  ties         smallint not null,
  outcome      text not null,             -- 'player_won' | 'ai_won' | 'tie'
  rounds       jsonb not null,            -- [{playerMove,aiMove,result,mode,called}]
  commit_hash  text not null,             -- keccak256(seed), issued before round 1
  seed         text not null,             -- revealed at match end (replayable proof)
  points       smallint not null default 0, -- ladder points earned this match
  week_key     text not null,             -- ISO week bucket, e.g. '2026-W27'
  attested     boolean not null default false, -- Oracle 8004 feedback emitted?
  created_at   timestamptz not null default now()
);

-- Weekly ladder aggregation + player history reads
create index if not exists idx_arena_matches_week
  on arena_free_matches (week_key, wallet);
create index if not exists idx_arena_matches_wallet
  on arena_free_matches (wallet, created_at desc);
-- Oracle attestor scans for unattested receipts
create index if not exists idx_arena_matches_unattested
  on arena_free_matches (created_at) where attested = false;
