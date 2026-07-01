import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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
  const today = new Date().toISOString().slice(0, 10)

  const [accounts, contacts, conversations, activity, messages, statsToday] = await Promise.all([
    client.from('outreach_accounts').select('*').order('id'),
    client.from('outreach_contacts').select('*').order('replied_at', { ascending: false, nullsFirst: false }).order('sent_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }),
    client.from('outreach_conversations').select('*, outreach_contacts(username, tg_id)').order('updated_at', { ascending: false }),
    client.from('outreach_activity').select('session,type,detail,done_at').gte('done_at', today),
    client.from('outreach_messages').select('id,contact_id,direction,text,sent_at').order('id', { ascending: true }).limit(2000),
    Promise.all([
      client.from('outreach_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').gte('sent_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).gte('sent_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'replied').gte('replied_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'replied'),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ])
  ])

  const [msgToday, contactsToday, repliedToday, repliedAll, sentAll, newAll] = statsToday
  const sentTodayCount    = contactsToday.count ?? 0
  const repliedTodayCount = repliedToday.count ?? 0

  const syncRow = await client.from('outreach_accounts').select('synced_at').order('synced_at', { ascending: false }).limit(1).single()

  return NextResponse.json({
    accounts:      accounts.data ?? [],
    contacts:      contacts.data ?? [],
    conversations: conversations.data ?? [],
    activity:      activity.data ?? [],
    messages:      messages.data ?? [],
    synced_at:     syncRow.data?.synced_at ?? null,
    stats: {
      messages_today:   msgToday.count ?? 0,
      sent_today:       sentTodayCount,
      replied_today:    repliedTodayCount,
      conversion_today: sentTodayCount > 0 ? Math.round(repliedTodayCount / sentTodayCount * 100) : 0,
      replied_all:      repliedAll.count ?? 0,
      sent_all:         sentAll.count ?? 0,
      new_all:          newAll.count ?? 0,
    },
  })
}
