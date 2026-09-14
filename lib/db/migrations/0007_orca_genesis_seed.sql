-- Seeds the TGE cost-basis lot for ORCA. Source of truth: v1 hardcode in
-- tidelog/tidelog-frontend/index.html n40GenesisTxs (verified with finance
-- 2026-05-02 — see PR description for confirmation).
--
-- Idempotent via ON CONFLICT (tx_unique constraint on
-- (tx_hash, wallet_address, asset, direction)). Re-running is a no-op.
--
-- Default-exclusion in lib/treasury-transactions.ts (already in main) keeps
-- this row invisible to the Transactions page and months filter; FIFO and
-- the ORCA Ledger orchestrator query directly so genesis flows through.

-- The transaction below has an FK to app.wallet, but nothing else creates this
-- wallet on a fresh database (seed.ts registers wallets via the admin UI), so
-- db:migrate failed on new clones. Seed the wallet first. ON CONFLICT DO NOTHING
-- leaves existing databases untouched — they already hold this wallet with its
-- real registration — so only fresh clones get this row.
INSERT INTO app.wallet (address, label, chain, entity_id)
VALUES (
  'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1',
  'Foundation - ORCA Genesis (TGE)',
  'SOL',
  'foundation'
)
ON CONFLICT (address) DO NOTHING;

INSERT INTO app.transaction (
  id, tx_hash, wallet_address, entity_id, block_time, asset,
  qty, direction, price, usd, price_source, counterparty, category, created_at
) VALUES (
  gen_random_uuid(),
  'genesis-orca-tokens-main-20210809',
  'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1',
  'foundation',
  '2021-08-09 00:00:00+00',
  'ORCA',
  87656098.41,
  'in',
  2.64956,
  232224289.49,
  'genesis',
  NULL,
  NULL,
  now()
)
ON CONFLICT ON CONSTRAINT tx_unique DO NOTHING;
