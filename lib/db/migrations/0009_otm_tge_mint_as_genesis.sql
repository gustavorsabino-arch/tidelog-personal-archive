-- Mark the real on-chain TGE mint event as 'genesis' price_source so the
-- ORCA Ledger UI's "Genesis" type filter finds it (and downstream FIFO/UI
-- treats it the same way the synthetic genesis row was treated, before it
-- was removed by the cron-refactor backfill).
--
-- The synthetic 87.65M genesis row (migrations 0007 + 0008) was a stand-in
-- for OTM's TGE allocation back when the cron couldn't ingest the real
-- on-chain mint event due to the legacy meta-balance schema bug. After the
-- Helius Enhanced API + ATA-aware refactor (#19), the real event lands in
-- DB via cron with `price_source='cache'`; we override it to 'genesis' here
-- so the UI's existing genesis-special-casing keeps working.
--
-- This migration is IDEMPOTENT: the WHERE clause restricts the update to
-- the specific TGE sig + wallet + asset + direction; if the row's
-- price_source is already 'genesis' (e.g., re-running migration), the
-- UPDATE matches 0 rows and is a no-op. If the row doesn't exist yet
-- (fresh DB clone before the OTM backfill has run), the UPDATE also
-- matches 0 rows; running --full on OTM and then this migration in either
-- order produces the correct end state.

UPDATE app.transaction
SET price_source = 'genesis'
WHERE tx_hash       = '3SBbqGDjVmQVfy5YjvG53Zp91uBBSwa1ViQfnD3P5SgpF76fs3tavtwGiYLQB5HEWtgKCMrkoTQmMhP4DWyC6ap3'
  AND wallet_address = 'GjKxauMroc9MT27xXYyjLYNfy9nSS5EuHTmzhdkjCAR1'
  AND asset          = 'ORCA'
  AND direction      = 'in'
  AND price_source  != 'genesis';
