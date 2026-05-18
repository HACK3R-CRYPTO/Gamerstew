-- Tie-refund tracking. Routes every tie through resolveMatch(agent) on
-- chain (winner = AI) and then sends a ~0.98× wager refund to the player
-- from the agent's wallet. This avoids a contract redeploy while removing
-- the asymmetric tie rule. Schema extension only.

alter table agent_match_state
  add column if not exists outcome           text,            -- 'ai_won' | 'player_won' | 'tie'
  add column if not exists tie_refund_wei    numeric(78,0),   -- amount sent back to the player on a tie
  add column if not exists refund_tx_hash    text,            -- chain tx hash of the refund transfer
  add column if not exists refund_pending    boolean default false,  -- true after we resolve but before the refund clears
  add column if not exists tie_reason        text;            -- 'rps_same' | 'coin_both_right' | 'coin_both_wrong' | etc.

create index if not exists idx_agent_match_state_outcome
  on agent_match_state (outcome);

-- Surface unfinished refunds so the agent can retry on boot.
create index if not exists idx_agent_match_state_refund_pending
  on agent_match_state (accepted_at) where refund_pending;
