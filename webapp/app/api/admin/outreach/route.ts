import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAdminSession } from '@/lib/auth/adminApi'
import { loadOutreachData } from '@/lib/queries/outreach'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const unauthorized = requireAdminSession(req)
  if (unauthorized) return unauthorized

  const data = await loadOutreachData(createServerSupabaseClient())
  return NextResponse.json(data)
}
