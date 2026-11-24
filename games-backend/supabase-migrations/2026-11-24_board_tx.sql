-- 2026-11-24 · Every row on a leaderboard carries its on-chain transaction.
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- The boards are built from our own record of finished runs, which is fast and
-- does not depend on the subgraph. But that record did not say WHICH
-- transaction put a score on the chain, so the boards lost the link a player
-- could follow to check it. This puts it back: each player's best score comes
-- with the transaction that recorded it.
--
-- The function's shape changes, so it is dropped and made again.

drop function if exists board_window(text, timestamptz, int, int);

create function board_window(p_game text, p_since timestamptz, p_limit int, p_offset int)
returns table (wallet text, best integer, plays bigint, last_at timestamptz, total bigint, tx_hash text)
language sql stable as $$
  with per_player as (
    select lower(s.wallet) as wallet, max(s.computed_score) as best, count(*) as plays, max(s.used_at) as last_at
    from game_sessions s
    where s.used and s.game = p_game and s.used_at >= p_since and s.computed_score is not null
    group by lower(s.wallet)
  ),
  page as (
    select p.wallet, p.best, p.plays, p.last_at, count(*) over () as total
    from per_player p
    order by p.best desc, p.last_at asc
    limit greatest(1, least(p_limit, 200)) offset greatest(0, p_offset)
  )
  select g.wallet, g.best, g.plays, g.last_at, g.total,
         -- the transaction for this player's best saved run of the game in the window
         (select a.tx_hash from activity a
           where a.game = p_game and lower(a.wallet_address) = g.wallet and a.created_at >= p_since and a.tx_hash is not null
           order by a.score desc, a.created_at desc limit 1) as tx_hash
  from page g
  order by g.best desc, g.last_at asc;
$$;

-- the lookup above, kept quick as the table grows
create index if not exists activity_game_wallet_score_idx on activity (game, lower(wallet_address), score desc) where tx_hash is not null;
