import { NextRequest, NextResponse } from 'next/server'

import { deleteAdminAccessUser, loadAdminAccessSnapshot, saveAdminAccessUser } from '@/lib/admin-access'
import type { AdminAccessUserInput } from '@/lib/admin-access-model'
import { requireAdminAccess } from '@/lib/admin-access-control'

export const runtime = 'nodejs'

function parseYear(value: unknown): number | null {
  const year = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(year) ? year : null
}

export async function GET(req: NextRequest) {
  const accessResult = await requireAdminAccess(req)
  if (!accessResult.ok) return accessResult.response

  const year = parseYear(req.nextUrl.searchParams.get('year')) ?? 2026
  const snapshot = await loadAdminAccessSnapshot(year)
  return NextResponse.json(snapshot)
}

export async function POST(req: NextRequest) {
  const accessResult = await requireAdminAccess(req)
  if (!accessResult.ok) return accessResult.response

  const body = await req.json().catch(() => null)
  if (!body?.user || typeof body.user !== 'object') {
    return NextResponse.json({ error: 'Expected a user payload.' }, { status: 400 })
  }

  try {
    const savedUser = await saveAdminAccessUser(body.user as AdminAccessUserInput)
    return NextResponse.json({ user: savedUser })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save access user.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const accessResult = await requireAdminAccess(req)
  if (!accessResult.ok) return accessResult.response

  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  try {
    await deleteAdminAccessUser(email)
    return NextResponse.json({ success: true, email })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete access user.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
