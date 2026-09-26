-- ============================================================================
-- GameArena — Competition Payouts to Verified Players (Celo)
-- Paste as a NEW Dune query, then add it to dune.com/ogazboiz/gamearena.
-- This is the panel GoodDollar can open to see exactly what has moved.
--
-- Every payout is sent from the GameArena competition wallet. The treasury /
-- change wallet is excluded, so this shows ONLY what reached players.
--
--   payout wallet   0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d
--   treasury (excl) 0xD152f549545093347A162Dce210e7293f1452150
--   G$ token        0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a
--   USDC token      0xceba9300f2b948710d2653dd7b07f33a8b32118c
-- ============================================================================

WITH payouts AS (
  SELECT
    block_time,
    block_date,
    tx_hash,
    symbol,
    "to"        AS recipient,
    amount,
    amount_usd
  FROM tokens.transfers
  WHERE blockchain = 'celo'
    AND block_month >= date '2026-05-01'                              -- partition prune
    AND "from" = 0xa479b8c6030cBB01f8E9F6AcB2Ad2C757C81894d          -- payout wallet
    AND "to"  != 0xD152f549545093347A162Dce210e7293f1452150          -- exclude treasury leg
    AND contract_address IN (
      0x62b8b11039fcfe5ab0c56e502b1c372a3d2a9c7a,                    -- G$
      0xceba9300f2b948710d2653dd7b07f33a8b32118c                     -- USDC
    )
)
SELECT
  min(block_time)                            AS paid_at,
  CASE tx_hash
    WHEN 0x1b1228211e85efaec57278b5b66dae7e383cf649df1782f43d616a4c86e1366a
      THEN 'Community Pool (Aug 24 - Sep 6)'
    WHEN 0xdc43bef25b7e96a2c8685de052bddbfd9adbd4e374f384d0dbdaf2c4ef9c3d84
      THEN 'Skill Sprint (top 10)'
    ELSE 'Competition payout'
  END                                        AS competition,
  symbol,
  count(*)                                   AS players_paid,
  round(sum(amount), 0)                      AS amount_paid,
  round(sum(amount_usd), 2)                  AS usd_value,
  tx_hash
FROM payouts
GROUP BY tx_hash, symbol
ORDER BY paid_at DESC;


-- ============================================================================
-- COMPANION QUERY · headline totals (paste as a second query for a big-number
-- counter panel: "G$ moved to players" and "USD value paid out").
-- ============================================================================
-- WITH payouts AS ( ...same CTE as above... )
-- SELECT
--   symbol,
--   count(DISTINCT recipient)  AS distinct_players,
--   round(sum(amount), 0)      AS total_paid,
--   round(sum(amount_usd), 2)  AS total_usd_value
-- FROM payouts
-- GROUP BY symbol;
