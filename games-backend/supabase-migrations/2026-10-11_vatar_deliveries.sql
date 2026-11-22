-- Vatar (Lagos Life) in-game purchase deliveries.
-- One row per Vatar purchase id, so a purchase is granted EXACTLY once no matter
-- how many times it is delivered: both the client /api/vatar/claim call and the
-- server /api/vatar/webhook can fire for the same purchase, and the purchase_id
-- primary key makes the second one a no-op (unique violation = already done).
--   player_id  — Vatar's player id, from POST /session/verify
--   product_id — the id set in the Vatar dashboard (a-z, 0-9, _ , -)
--   wallet     — the linked GameArena account when the game passed one, else null
--   status     — 'delivered' once the item is granted and Vatar is told
create table if not exists vatar_deliveries (
  purchase_id text primary key,
  player_id   text not null,
  product_id  text not null,
  wallet      text,
  status      text not null default 'delivered',
  created_at  timestamptz default now()
);

create index if not exists vatar_deliveries_player_idx on vatar_deliveries (player_id);
create index if not exists vatar_deliveries_wallet_idx on vatar_deliveries (wallet);
