import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ''

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-secret') !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = sb()

  const [leads, messages] = await Promise.all([
    client.from('inbox_leads').select('*').order('last_msg_at', { ascending: false }).limit(500),
    client.from('inbox_messages').select('*').order('received_at', { ascending: true }).limit(5000),
  ])

  return NextResponse.json({
    leads:    leads.data    ?? [],
    messages: messages.data ?? [],
  })
}
