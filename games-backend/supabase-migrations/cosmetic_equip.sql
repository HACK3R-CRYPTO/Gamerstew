-- Cosmetic equip preferences, keyed by wallet so the on/off choice follows
-- the account across browsers and devices (ownership already lives on-chain;
-- this is only "is the owned skin currently applied"). We store a row ONLY
-- when a player makes an explicit choice — absence means the default (ON).
create table if not exists cosmetic_equip (
  wallet     text        not null,
  perk_id    integer     not null,
  equipped   boolean     not null default true,
  updated_at timestamptz not null default now(),
  primary key (wallet, perk_id)
);

create index if not exists cosmetic_equip_wallet_idx on cosmetic_equip (wallet);
