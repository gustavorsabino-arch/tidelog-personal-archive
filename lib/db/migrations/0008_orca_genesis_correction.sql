-- Corrects the ORCA genesis seed quantity for Foundation Orca Tokens Main.
--
-- The 0007 seed used v1's `n40GenesisTxs` hardcode (87,656,098.41), which
-- under-counted the actual on-chain TGE allocation by 291.50 ORCA. Evidence:
--   • Solscan balance for GjKx... on 2021-12-23 15:30:49 UTC: 87,056,098.412907
--   • DB-recorded Outs from that wallet before that snapshot:
--       2021-12-13: 291.50    (tx 48iB6FxgmQtUrQ8Y...)
--       2021-12-16: 600000.00 (tx J9JNPbd7fovqzrp4...)
--   • Inferred initial = 87,056,098.412907 + 291.50 + 600000.00
--                      = 87,656,389.912907
--
-- This also tightened the previous USD value (232,224,289.49 was off by
-- ~$25,800 from qty × price; we recompute exactly).
--
-- Verifier: /tmp/claude/verify_tge_amount.sql at the time of this migration.

UPDATE app.transaction
SET qty = 87656389.912907,
    usd = 87656389.912907 * price
WHERE tx_hash      = 'genesis-orca-tokens-main-20210809'
  AND price_source = 'genesis'
  AND qty          = 87656098.41;
