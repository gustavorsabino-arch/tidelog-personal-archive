-- Single tx can produce moves for multiple assets on the same wallet+direction
-- (e.g. a swap: SOL out + ORCA out from the same wallet, same tx_hash). The
-- original PK (tx_hash, wallet_address, direction) prevented per-asset
-- materialization for those rows. Mirror the unique constraint on
-- app.transaction (tx_hash, wallet_address, asset, direction).
ALTER TABLE "app"."transaction_gain" DROP CONSTRAINT "transaction_gain_tx_hash_wallet_address_direction_pk";--> statement-breakpoint
ALTER TABLE "app"."transaction_gain" ADD CONSTRAINT "transaction_gain_tx_hash_wallet_address_direction_asset_pk" PRIMARY KEY("tx_hash","wallet_address","direction","asset");
