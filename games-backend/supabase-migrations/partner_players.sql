-- Partner player identity map.
-- The wallet is the universal join key between GameArena and a partner game
-- (e.g. BlockSlide). A player can arrive through the partner's own website
-- (where they got a partner name) or through GameArena (where they got a
-- GamePass name). This table stores the *partner-side* display name for a
-- wallet, so a player who joined through the partner still shows a real name
-- on GameArena's boards — GamePass names stay on-chain and are read separately.
create table if not exists partner_players (
  game          text        not null,
  wallet_address text       not null,
  name          text,
  updated_at    timestamptz not null default now(),
  primary key (game, wallet_address)
);

create index if not exists partner_players_wallet_idx on partner_players (wallet_address);
