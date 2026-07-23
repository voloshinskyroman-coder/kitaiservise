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
  sentiment: 'green' | 'warm' | 'red' | 'gray' | null
  sentiment_reason: string | null
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

// Supabase (PostgREST) жёстко режет ЛЮБОЙ select до db-max-rows (обычно 1000) —
// .limit(2000) в коде это не переопределяет. При росте базы это тихо обрезало
// contacts/messages, и новые записи (включая сегодняшние) просто не долетали до
// админки. Тянем постранично по PAGE_SIZE, пока страница не окажется неполной.
type OrderableQuery = {
  order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => OrderableQuery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  range: (a: number, b: number) => Promise<{ data: any[] | null; error: unknown }>
}

async function fetchAllPages<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  applyOrder: (q: OrderableQuery) => OrderableQuery,
  maxRows: number,
): Promise<T[]> {
  const PAGE_SIZE = 1000
  const rows: T[] = []
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const base = client.from(table).select(columns) as unknown as OrderableQuery
    const { data, error } = await applyOrder(base).range(offset, offset + PAGE_SIZE - 1)
    if (error || !data || data.length === 0) break
    rows.push(...(data as T[]))
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

/** Единая точка чтения outreach-данных — используется и SSR-страницей, и API-роутом для live-обновления. */
export async function loadOutreachData(client: SupabaseClient): Promise<OutreachData> {
  const today = new Date().toISOString().slice(0, 10)

  const [accounts, contacts, conversations, activity, messages, statsToday] = await Promise.all([
    client.from('outreach_accounts').select('*').order('id'),
    fetchAllPages<OutreachContact>(
      client,
      'outreach_contacts',
      '*',
      (q) =>
        q
          .order('replied_at', { ascending: false, nullsFirst: false })
          .order('sent_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false }),
      5000,
    ),
    client
      .from('outreach_conversations')
      .select('*, outreach_contacts(username, tg_id)')
      .order('updated_at', { ascending: false }),
    client.from('outreach_activity').select('session,type,detail,done_at').gte('done_at', today),
    fetchAllPages<OutreachMessage>(
      client,
      'outreach_messages',
      'id,contact_id,direction,text,sent_at',
      (q) => q.order('id', { ascending: false }),
      5000,
    ),
    Promise.all([
      client.from('outreach_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').gte('sent_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).gte('sent_at', today),
      // replied_at (не status) — правильный сигнал "отвечал ли когда-либо": status может
      // потом смениться на 'skipped', если оператор закрыл диалог, а replied_at при этом
      // не трогается (см. lib/queries/outreach.ts repliedContactIds для той же логики на фронте).
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).not('replied_at', 'is', null).gte('replied_at', today),
      client.from('outreach_contacts').select('id', { count: 'exact', head: true }).not('replied_at', 'is', null),
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
    contacts,
    conversations: (conversations.data ?? []) as OutreachConversation[],
    activity: (activity.data ?? []) as OutreachActivityEntry[],
    messages,
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
