-- Faucet claims: one row per wallet that's received a CELO gas drip from
-- the server-side faucet. The faucet covers fresh wallets so first-tx
-- friction (insufficient gas on GamePass mint / score submit) disappears
-- during onboarding · Susanne flagged "the top-up wall" as the killer
-- friction for the MiniPay audience, this is the fix.
--
-- The table is the source of truth for "has this wallet been topped up
-- already". UNIQUE constraint on wallet enforces one-drip-per-wallet,
-- ever · cheaper sybil defense than complex rate logic, and a player
-- who burns through 0.1 CELO is already deep enough in the funnel that
-- they should pay their own gas like everyone else.

create table if not exists faucet_claims (
  id            uuid primary key default gen_random_uuid(),
  wallet        text not null unique,
  privy_user_id text,                                  -- nullable for MiniPay path (no Privy)
  ip_hash       text,                                  -- sha256 of IP for forensics without storing raw IPs
  amount_wei    text not null,                         -- as string · BigInt safe
  tx_hash       text not null,
  claimed_at    timestamptz not null default now()
);

-- Wallet lookups are exact-match · O(1) via the unique index.
create unique index if not exists idx_faucet_claims_wallet
  on faucet_claims (wallet);

-- Per-IP daily counting · WHERE claimed_at filter happens at query time.
create index if not exists idx_faucet_claims_ip_time
  on faucet_claims (ip_hash, claimed_at desc);

-- Privy user dedup · same human, multiple wallets shouldn't drain N drips.
create index if not exists idx_faucet_claims_privy_user
  on faucet_claims (privy_user_id)
  where privy_user_id is not null;
