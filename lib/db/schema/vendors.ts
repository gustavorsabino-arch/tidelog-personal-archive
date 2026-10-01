import { pgSchema, text, timestamp } from 'drizzle-orm/pg-core'

const app = pgSchema('app')

/**
 * Vendor master defaults (finance's Book12): which GL account and class a
 * vendor's spend belongs to. Global (not per entity) — the master file has
 * one row per vendor. Picking a vendor on a transaction auto-fills the
 * counterparty GL and class from here. Managed in the /vendors page;
 * seeded once from the Book12 export.
 */
export const vendorDefault = app.table('vendor_default', {
  vendorName: text('vendor_name').primaryKey(),
  glAccount: text('gl_account').notNull(),        // "61020"
  glAccountName: text('gl_account_name'),         // "Company Tools"
  className: text('class_name'),                  // "Ops"
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),                  // email; 'book12-seed' for the initial load
})

/** App audit inventory, initially imported from the rows marked Current. */
export const appCatalog = app.table('app_catalog', {
  appName: text('app_name').primaryKey(),
  description: text('description'),
  paymentTerm: text('payment_term'),
  paymentMethod: text('payment_method'),
  amount: text('amount'),
  classTeam: text('class_team'),
  accountOwner: text('account_owner'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
})

export const appCatalogImport = app.table('app_catalog_import', {
  key: text('key').primaryKey(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
})
