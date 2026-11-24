-- Vatar (Lagos Life) players ↔ their custodial Celo wallet.
-- Each Vatar playerId maps to a DETERMINISTIC custodial wallet derived from
-- VATAR_CUSTODY_SEED (the private key is never stored, only re-derived). This
-- table records the address + whether we've minted their GamePass, so the
-- "on embed load" provisioning is idempotent and we never double-mint.
--   player_id — Vatar's player id (from POST /session/verify)
--   address   — the derived custodial wallet (0x…), lowercase
--   username  — the GamePass username we minted ("ll_<hex>")
--   minted    — true once the GamePass mint confirmed on-chain
create table if not exists vatar_wallets (
  player_id  text primary key,
  address    text not null,
  username   text,
  minted     boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists vatar_wallets_address_idx on vatar_wallets (address);
