-- Behavior-preservation gate for the Helius Enhanced API cron refactor.
--
-- Usage (run after `bun run cron:fetch-transactions --full --wallet=<addr>`
-- against a LOCAL DB whose transaction table was pre-loaded from prod for the
-- comparison wallet):
--
-- 1. Pre-load: \copy app.transaction (...) from prod for the wallet under test
--    (or pg_dump --table=app.transaction --where="wallet_address = '<addr>'" prod
--    and restore into local).
-- 2. Run the cron locally with --full for that wallet.
-- 3. Run this script with :wallet set to the wallet address.
--
-- Acceptance criteria (per spec §9):
--   - Rows in local but not in prod: ACCEPTABLE (these are the recovered moves
--     the bug was dropping — typically pre-2022 receives).
--   - Rows in prod but not in local: NOT ACCEPTABLE (regression).
--   - Matching (tx_hash, wallet, asset, direction) with different qty:
--     NOT ACCEPTABLE (regression).
--   - Matching rows with different counterparty: review case-by-case
--     (Helius's owner resolution may differ from the old largest-delta heuristic).

-- Fail loudly if the operator forgot to pass :wallet on the psql command line.
-- Without this guard, every query below returns 0 rows and the gate silently looks clean.
\if :{?wallet}
\else
\warn 'ERROR: :wallet not set; pass `-v wallet=''<addr>''` on the psql command line'
\quit
\endif

-- (A) Counts side by side.
SELECT 'local' AS source, COUNT(*) AS rows FROM app.transaction WHERE wallet_address = :wallet
UNION ALL
SELECT 'prod_snapshot' AS source, COUNT(*) AS rows FROM app.transaction_prod_snapshot WHERE wallet_address = :wallet;

-- (B) Rows in local but not in prod_snapshot (recovered — should mostly be pre-2022).
SELECT 'local_only' AS bucket, l.tx_hash, l.asset, l.direction, l.qty, l.block_time::date
FROM app.transaction l
LEFT JOIN app.transaction_prod_snapshot p
  ON p.tx_hash = l.tx_hash AND p.wallet_address = l.wallet_address
  AND p.asset = l.asset AND p.direction = l.direction
WHERE l.wallet_address = :wallet AND p.tx_hash IS NULL
ORDER BY l.block_time;

-- (C) Rows in prod_snapshot but missing from local — REGRESSION if any rows here.
SELECT 'prod_only_REGRESSION' AS bucket, p.tx_hash, p.asset, p.direction, p.qty, p.block_time::date
FROM app.transaction_prod_snapshot p
LEFT JOIN app.transaction l
  ON l.tx_hash = p.tx_hash AND l.wallet_address = p.wallet_address
  AND l.asset = p.asset AND l.direction = p.direction
WHERE p.wallet_address = :wallet AND l.tx_hash IS NULL
ORDER BY p.block_time;

-- (D) Matching natural keys with diverged qty — REGRESSION if any rows here.
SELECT 'qty_mismatch_REGRESSION' AS bucket, l.tx_hash, l.asset, l.direction,
       l.qty AS local_qty, p.qty AS prod_qty, l.block_time::date
FROM app.transaction l
JOIN app.transaction_prod_snapshot p
  ON p.tx_hash = l.tx_hash AND p.wallet_address = l.wallet_address
  AND p.asset = l.asset AND p.direction = l.direction
WHERE l.wallet_address = :wallet AND l.qty <> p.qty
ORDER BY l.block_time;

-- (E) Counterparty differences — review case-by-case, not auto-blocking.
SELECT 'counterparty_diff' AS bucket, l.tx_hash, l.asset, l.direction,
       l.counterparty AS local_cp, p.counterparty AS prod_cp, l.block_time::date
FROM app.transaction l
JOIN app.transaction_prod_snapshot p
  ON p.tx_hash = l.tx_hash AND p.wallet_address = l.wallet_address
  AND p.asset = l.asset AND p.direction = l.direction
WHERE l.wallet_address = :wallet
  AND COALESCE(l.counterparty, '') <> COALESCE(p.counterparty, '')
ORDER BY l.block_time;
