import { NextRequest, NextResponse } from 'next/server'
import { verifyTelegramInitData } from '@/lib/telegram/verifyInitData'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getStartQuestion } from '@/lib/engines/decisionEngine'

export async function POST(req: NextRequest) {
  const { initData } = (await req.json()) as { initData?: string }
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!initData || !botToken) {
    return NextResponse.json({ error: 'initData или TELEGRAM_BOT_TOKEN отсутствуют' }, { status: 400 })
  }

  const verified = verifyTelegramInitData(initData, botToken)
  if (!verified) {
    return NextResponse.json({ error: 'Не удалось подтвердить подпись Telegram' }, { status: 401 })
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('shipments')
    .insert({
      telegram_user_id: verified.user?.id ?? null,
      telegram_username: verified.user?.username ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sessionId: data.id, question: getStartQuestion() })
}
