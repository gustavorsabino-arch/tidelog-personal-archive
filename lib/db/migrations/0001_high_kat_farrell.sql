-- qb_connection: move PK from realm_id to entity_id so multiple entities
-- can share one sandbox realm without collisions.
ALTER TABLE "qb_account_map" DROP CONSTRAINT "qb_account_map_realm_id_qb_connection_realm_id_fk";--> statement-breakpoint
ALTER TABLE "qb_connection" DROP CONSTRAINT "qb_connection_pkey";--> statement-breakpoint
ALTER TABLE "qb_connection" ADD PRIMARY KEY ("entity_id");
