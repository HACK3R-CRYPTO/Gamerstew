-- AI strategy mode used for this match. Set at resolve time from the
-- seed-derived coin flip in OpponentModel.predict. Values:
--   'markov'      — agent ran Markov-2/-1 counter strategy
--   'random'      — agent played uniformly random (seeded-fair coin flip)
--   'cold_start'  — no history, agent used opening-bias mix
-- A verifier with the seed can re-run predict and confirm the mode
-- recorded here matches what the seed dictates.

alter table agent_match_state
  add column if not exists mode text;
