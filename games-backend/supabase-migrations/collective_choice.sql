-- GoodCollective choice · milestone "GoodCollective picker".
--
-- Each player picks which GoodCollective their G$ spending's UBI share
-- supports. On-chain the 20% split flows to one pool (PerkShop.ubiPool /
-- HabitatRegistry.ubiPool — both 0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1
-- today), so this table is the per-player ATTRIBUTION ledger: it records the
-- player's chosen collective for display (passport, impact) and for routing
-- accumulated shares when multi-pool payouts happen. One row per wallet,
-- last choice wins.

create table if not exists collective_choice (
  wallet        text primary key,
  collective_id text not null,
  set_at        timestamptz not null default now()
);
