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

/**
 * Кладёт ответ оператора в очередь `outreach_pending_replies` — забирает
 * sync_to_supabase.py на сервере рассылки (каждые ~20с) и ставит в
 * pending_operator_sends, чтобы демон отправил его от имени нужного
 * менеджера. Прямой отправки в Telegram отсюда нет и не будет — только
 * сервер рассылки держит живые сессии аккаунтов.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireAdminSession(req)
  if (unauthorized) return unauthorized

  const body = await req.json().catch(() => null)
  const contactId = body?.contact_id
  const accountId = body?.account_id
  const action = body?.action === 'skip' ? 'skip' : 'send'
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!Number.isFinite(contactId) || !Number.isFinite(accountId)) {
    return NextResponse.json({ error: 'contact_id и account_id обязательны' }, { status: 400 })
  }
  if (action === 'send' && !text) {
    return NextResponse.json({ error: 'text обязателен для отправки' }, { status: 400 })
  }

  const { error } = await createServerSupabaseClient()
    .from('outreach_pending_replies')
    .insert({ contact_id: contactId, account_id: accountId, action, text: action === 'send' ? text : null })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
