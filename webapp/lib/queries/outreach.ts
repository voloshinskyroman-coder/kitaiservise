import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type OutreachAccount = {
  id: number
  session: string
  phone: string | null
  gender: string | null
  status: string
  daily_limit: number
  paused_until: string | null
  flood_count: number | null
  sent_today: number
  synced_at: string | null
  created_at: string | null
  name: string | null
  avatar_url: string | null
}

export type OutreachContact = {
  id: number
  tg_id: string
  username: string | null
  status: string
  account_id: number | null
  account_session: string | null
  imported_at: string | null
  sent_at: string | null
  replied_at: string | null
}

export type OutreachConversation = {
  id: number
  contact_id: number
  account_id: number | null
  status: string
  ai_draft: string | null
  created_at: string | null
  updated_at: string | null
  outreach_contacts: { username: string | null; tg_id: string } | null
}

export type OutreachMessage = {
  id: number
  contact_id: number
  direction: string
  text: string | null
  sent_at: string | null
}

export type OutreachActivityEntry = { session: string; type: string; detail: string; done_at: string }

export type OutreachStats = {
  messages_today: number
  sent_today: number
  replied_today: number
  conversion_today: number
  replied_all: number
  sent_all: number
  new_all: number
}

export type OutreachData = {
  accounts: OutreachAccount[]
  contacts: OutreachContact[]
  conversations: OutreachConversation[]
  activity: OutreachActivityEntry[]
  messages: OutreachMessage[]
  synced_at: string | null
  stats: OutreachStats
}

/** Единая точка чтения outreach-данных — используется и SSR-страницей, и API-роутом для live-обновления. */
export async function loadOutreachData(client: SupabaseClient): Promise<OutreachData> {
  const today = new Date().toISOString().slice(0, 10)

  const [accounts, contacts, conversations, activity, messages, statsToday] = await Promise.all([
    client.from('outreach_accounts').select('*').order('id'),
    client
      .from('outreach_contacts')
      .select('*')
      .order('replied_at', { ascending: false, nullsFirst: false })
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false }),
    client
      .from('outreach_conversations')
      .select('*, outreach_contacts(username, tg_id)')
      .order('updated_at', { ascending: false }),
    client.from('outreach_activity').select('session,type,detail,done_at').gte('done_at', today),
    client.from('outreach_messages').select('id,contact_id,direction,text,sent_at').order('id', { ascending: true }).limit(2000),
    Promise.all([
      client.from('outreach_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').gte('sent_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).gte('sent_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'replied').gte('replied_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'replied'),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ]),
  ])

  const [msgToday, contactsToday, repliedToday, repliedAll, sentAll, newAll] = statsToday
  const sentTodayCount = contactsToday.count ?? 0
  const repliedTodayCount = repliedToday.count ?? 0

  const syncRow = await client
    .from('outreach_accounts')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    accounts: (accounts.data ?? []) as OutreachAccount[],
    contacts: (contacts.data ?? []) as OutreachContact[],
    conversations: (conversations.data ?? []) as OutreachConversation[],
    activity: (activity.data ?? []) as OutreachActivityEntry[],
    messages: (messages.data ?? []) as OutreachMessage[],
    synced_at: syncRow.data?.synced_at ?? null,
    stats: {
      messages_today: msgToday.count ?? 0,
      sent_today: sentTodayCount,
      replied_today: repliedTodayCount,
      conversion_today: sentTodayCount > 0 ? Math.round((repliedTodayCount / sentTodayCount) * 100) : 0,
      replied_all: repliedAll.count ?? 0,
      sent_all: sentAll.count ?? 0,
      new_all: newAll.count ?? 0,
    },
  }
}
