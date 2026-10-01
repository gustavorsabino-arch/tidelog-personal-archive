import { NextRequest, NextResponse } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { appCatalog, appCatalogImport } from '@/lib/db/schema'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { APP_SEED } from '@/lib/apps/seed-data'

export const runtime = 'nodejs'

// Production migrations are not run at deploy time; create on the first request.
let schemaReady: Promise<void> | undefined
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.execute(sql`CREATE TABLE IF NOT EXISTS app.app_catalog (
        app_name text PRIMARY KEY, description text, payment_term text,
        payment_method text, amount text, class_team text, account_owner text,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by text
      )`)
      await db.execute(sql`CREATE TABLE IF NOT EXISTS app.app_catalog_import (
        key text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now()
      )`)
    })().catch((err) => { schemaReady = undefined; throw err })
  }
  return schemaReady
}

type Body = Record<string, unknown>
type Field = 'description' | 'paymentTerm' | 'paymentMethod' | 'amount' | 'classTeam' | 'accountOwner'
const fields: Field[] = ['description', 'paymentTerm', 'paymentMethod', 'amount', 'classTeam', 'accountOwner']
function value(input: unknown): string | null {
  return typeof input === 'string' && input.trim() ? input.trim() : null
}
function payload(body: Body) {
  return Object.fromEntries(fields.map((field) => [field, value(body[field])])) as Record<Field, string | null>
}
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'App request failed' }, { status: 500 })
}
async function audit(user: { id: string; email: string }, action: string, name: string) {
  await logAudit({ userId: user.id === 'dev-user' ? null : user.id,
    action, resourceType: 'app_catalog', resourceId: name, metadata: { byEmail: user.email },
  }).catch(() => {})
}

export async function GET(req: NextRequest) {
  const { deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  try {
    await ensureSchema()
    const apps = await db.transaction(async (tx) => {
      // The marker commits together with the initial import. Deleting every app
      // later will not cause the spreadsheet rows to reappear.
      const inserted = await tx.insert(appCatalogImport).values({ key: 'app-audit-current-2026-09-17' })
        .onConflictDoNothing().returning({ key: appCatalogImport.key })
      if (inserted.length) await tx.insert(appCatalog).values(APP_SEED.map((row) => ({ ...row, updatedBy: 'app-audit-seed' }))).onConflictDoNothing()
      return tx.select().from(appCatalog).orderBy(asc(appCatalog.appName))
    })
    return NextResponse.json({ apps })
  } catch (error) { return failure(error) }
}

export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  try {
    await ensureSchema()
    const body = await req.json().catch(() => ({})) as Body
    const appName = value(body.appName)
    if (!appName) return NextResponse.json({ error: 'App name is required' }, { status: 400 })
    const [created] = await db.insert(appCatalog).values({ appName, ...payload(body), updatedBy: user.email })
      .onConflictDoNothing().returning()
    if (!created) return NextResponse.json({ error: 'App already exists' }, { status: 409 })
    await audit(user, 'app_catalog.created', appName)
    return NextResponse.json({ app: created }, { status: 201 })
  } catch (error) { return failure(error) }
}

export async function PATCH(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  try {
    await ensureSchema()
    const body = await req.json().catch(() => ({})) as Body
    const originalName = value(body.originalName)
    const appName = value(body.appName)
    if (!originalName || !appName) return NextResponse.json({ error: 'App name is required' }, { status: 400 })
    const [updated] = await db.update(appCatalog)
      .set({ appName, ...payload(body), updatedAt: new Date(), updatedBy: user.email })
      .where(eq(appCatalog.appName, originalName)).returning()
    if (!updated) return NextResponse.json({ error: 'App not found' }, { status: 404 })
    await audit(user, 'app_catalog.updated', originalName)
    return NextResponse.json({ app: updated })
  } catch (error) { return failure(error) }
}

export async function DELETE(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny
  try {
    await ensureSchema()
    const name = value(new URL(req.url).searchParams.get('name'))
    if (!name) return NextResponse.json({ error: 'App name is required' }, { status: 400 })
    const deleted = await db.delete(appCatalog).where(eq(appCatalog.appName, name)).returning()
    if (!deleted.length) return NextResponse.json({ error: 'App not found' }, { status: 404 })
    await audit(user, 'app_catalog.deleted', name)
    return NextResponse.json({ ok: true })
  } catch (error) { return failure(error) }
}
