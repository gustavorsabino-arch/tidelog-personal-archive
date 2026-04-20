import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

import { createClient as createServerSupabaseClient } from '@/lib/supabase/server'

export type AuthenticatedUser = {
  email: string
}

export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) return null

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) return null

    const supabase = createSupabaseClient(url, anonKey)
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user?.email) return null
    return { email: data.user.email.toLowerCase() }
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user?.email) return null

  return { email: data.user.email.toLowerCase() }
}

