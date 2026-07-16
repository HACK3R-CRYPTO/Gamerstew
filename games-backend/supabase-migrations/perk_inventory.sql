-- Perk inventory: buy-ahead stock of consumable save/retry perks.
-- balance = perks bought (via PerkShop) minus perks used in-game. The Match
-- Pack (#6) grants matches through arena_daily instead; cosmetics are owned
-- on-chain. Grants are made idempotent by arena_purchases (tx_hash primary key),
-- so this table only holds the running per-perk balance.
create table if not exists perk_inventory (
  wallet     text not null,
  perk_id    int  not null,
  balance    int  not null default 0,
  updated_at timestamptz default now(),
  primary key (wallet, perk_id)
);

create index if not exists perk_inventory_wallet_idx on perk_inventory (wallet);
