-- Game sessions: server-issued tickets that prove a player started a game
-- on the server before they're allowed to submit a score.
--
-- The hole this closes: /api/sign-score used to sign any score for any wallet
-- as long as the wallet sig was valid. A cheater could skip playing entirely
-- and call sign-score directly with a fabricated score. Now sign-score
-- requires a session token issued by /api/start-game, and the score is
-- COMPUTED by the server from a tap log (not claimed by the client).

create table if not exists game_sessions (
  token       text primary key,
  wallet      text not null,
  game        text not null check (game in ('rhythm', 'simon')),
  started_at  timestamptz not null default now(),
  used        boolean not null default false,
  used_at     timestamptz,
  -- Server-computed score, written when sign-score processes the tap log.
  -- Stored for audit + leaderboard cross-check before USDC payout.
  computed_score integer,
  -- Number of taps the client sent. Useful for forensics.
  tap_count   integer
);

-- Lookup index for active session of a wallet+game pair (used = false).
-- Partial index keeps it small since used sessions stay in the table for audit.
create index if not exists idx_game_sessions_active
  on game_sessions (lower(wallet), game)
  where not used;

-- Forensic index — find all sessions for a wallet ordered by time.
create index if not exists idx_game_sessions_wallet_time
  on game_sessions (lower(wallet), started_at desc);
