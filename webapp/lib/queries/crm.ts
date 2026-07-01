import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPurposeLabel } from '@/lib/config/decisionTree'
import { formatPrice, DELIVERY_MODE_LABEL } from '@/lib/engines/logisticEngine'
import { classifyReply } from '@/lib/config/replySentiment'
import type { Shipment, LogistStatus } from '@/lib/types/shipment'

export type CrmMessage = { id: number; direction: 'in' | 'out'; text: string; date: string | null }

export type CrmCard = {
  id: string
  source: 'shipment' | 'outreach'
  status: LogistStatus
  name: string
  username: string | null
  phone: string | null
  summary: string
  lastActivity: string | null
  leadHref: string | null
  messages: CrmMessage[]
}

function shipmentToCard(s: Shipment): CrmCard {
  const parts = [getPurposeLabel(s.purpose), s.delivery_mode ? DELIVERY_MODE_LABEL[s.delivery_mode] : null, formatPrice(s)]
  return {
    id: `shipment:${s.id}`,
    source: 'shipment',
    status: s.logist_status,
    name: s.telegram_username ? `@${s.telegram_username}` : `id${s.telegram_user_id ?? '—'}`,
    username: s.telegram_username,
    phone: null,
    summary: parts.filter(Boolean).join(' · '),
    lastActivity: s.updated_at,
    leadHref: `/admin/leads/${s.id}`,
    messages: [],
  }
}

/** Заявки из Mini App + положительные ответы на холодную рассылку — единый CRM-пайплайн менеджера. */
export async function loadCrmCards(client: SupabaseClient): Promise<CrmCard[]> {
  const [shipmentsRes, contactsRes, messagesRes] = await Promise.all([
    client.from('shipments').select('*').eq('status', 'completed').order('updated_at', { ascending: false }).returns<Shipment[]>(),
    client.from('outreach_contacts').select('*').eq('status', 'replied'),
    client.from('outreach_messages').select('id,contact_id,direction,text,sent_at').order('sent_at', { ascending: true }),
  ])

  const shipmentCards = (shipmentsRes.data ?? []).map(shipmentToCard)

  const messagesByContact = new Map<number, { id: number; direction: string; text: string | null; sent_at: string | null }[]>()
  for (const m of messagesRes.data ?? []) {
    const list = messagesByContact.get(m.contact_id) ?? []
    list.push(m)
    messagesByContact.set(m.contact_id, list)
  }

  const outreachCards: CrmCard[] = []
  for (const c of contactsRes.data ?? []) {
    const msgs = messagesByContact.get(c.id) ?? []
    const lastIn = [...msgs].reverse().find((m) => m.direction === 'in')
    if (!lastIn || classifyReply(lastIn.text) !== 'green') continue

    outreachCards.push({
      id: `outreach:${c.id}`,
      source: 'outreach',
      status: (c.crm_status ?? 'new') as LogistStatus,
      name: c.username ? `@${c.username}` : `ID ${c.tg_id}`,
      username: c.username,
      phone: null,
      summary: lastIn.text ?? '',
      lastActivity: c.replied_at,
      leadHref: null,
      messages: msgs.map((m) => ({ id: m.id, direction: (m.direction === 'out' ? 'out' : 'in') as 'in' | 'out', text: m.text ?? '', date: m.sent_at })),
    })
  }

  return [...shipmentCards, ...outreachCards].sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''))
}
