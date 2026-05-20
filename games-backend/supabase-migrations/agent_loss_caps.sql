-- Daily loss-cap circuit breaker for the AI agent (MARKOV-1).
-- Replaces the disk-backed ./.loss-cap-state.json which doesn't survive
-- Railway container restarts. Two scopes per day:
--   scope = 'global'        — total G$ MARKOV has lost across all wallets
--   scope = <wallet address> — total G$ a single wallet has won from MARKOV
-- Both compared against env-driven caps in the agent. Rows for past days
-- are kept for audit + analytics, never read at runtime.

create table if not exists agent_loss_caps (
  scope_date date    not null,
  scope      text    not null,
  loss_wei   numeric(78,0) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_date, scope)
);

create index if not exists idx_agent_loss_caps_date
  on agent_loss_caps (scope_date desc);

-- Per-match audit log. One row per match the agent participated in.
-- The agent writes here on accept (ai_move/salt populated when committed),
-- then again on resolve. Lets us reconstruct the agent's full play
-- history off chain for analytics + dispute resolution.
create table if not exists agent_match_state (
  match_id    numeric(78,0) primary key,
  challenger  text not null,
  wager_wei   numeric(78,0) not null,
  game_type   smallint not null,
  ai_move     smallint,
  ai_salt     text,
  accepted_at timestamptz not null default now(),
  resolved_at timestamptz,
  ai_won      boolean,
  player_move smallint
);

create index if not exists idx_agent_match_state_unresolved
  on agent_match_state (accepted_at) where resolved_at is null;
create index if not exists idx_agent_match_state_challenger
  on agent_match_state (lower(challenger), accepted_at desc);

-- Atomic UPSERT-and-increment. Prevents lost writes when two matches
-- resolve in the same tick. Returns the new running total so the agent
-- can log it without a second round trip.
create or replace function agent_increment_loss(
  p_date  date,
  p_scope text,
  p_delta numeric
) returns numeric as $$
declare
  new_total numeric;
begin
  insert into agent_loss_caps (scope_date, scope, loss_wei, updated_at)
  values (p_date, p_scope, p_delta, now())
  on conflict (scope_date, scope)
  do update set loss_wei   = agent_loss_caps.loss_wei + excluded.loss_wei,
                updated_at = now()
  returning loss_wei into new_total;
  return new_total;
end;
$$ language plpgsql;
