-- Arena G$ perks: daily match limits + on-chain purchase receipts.
--
-- Economy rule: G$ is taken at the EDGES of play (access/protection),
-- never inside a match outcome. Every purchase is a plain G$ transfer
-- from the player to the transparent pool wallet, verified on-chain by
-- the backend before granting. Spent G$ feeds the same weekly pool that
-- pays the ladder on Sunday — the platform is the pipe, not the house.

-- Per-wallet daily match accounting. used counts started matches;
-- extra holds purchased refills for that day.
create table if not exists arena_daily (
  wallet     text not null,             -- lowercase player wallet
  day        date not null,             -- UTC day
  used       integer not null default 0,
  extra      integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wallet, day)
);

-- On-chain purchase receipts. tx_hash primary key = replay protection:
-- one transfer can only ever grant once.
create table if not exists arena_purchases (
  tx_hash    text primary key,
  wallet     text not null,
  sku        text not null,             -- 'refill_5' | (later: 'rematch', 'streak_shield', …)
  amount_wei numeric(78,0) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_arena_purchases_wallet
  on arena_purchases (wallet, created_at desc);
