import { NextRequest, NextResponse } from 'next/server'
import { verifyTelegramInitData } from '@/lib/telegram/verifyInitData'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getStartQuestion, resolveQuizState } from '@/lib/engines/decisionEngine'
import type { Shipment } from '@/lib/types/shipment'

export async function POST(req: NextRequest) {
  const { initData, checkOnly } = (await req.json()) as { initData?: string; checkOnly?: boolean }
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!initData || !botToken) {
    return NextResponse.json({ error: 'initData или TELEGRAM_BOT_TOKEN отсутствуют' }, { status: 400 })
  }

  const verified = verifyTelegramInitData(initData, botToken)
  if (!verified) {
    return NextResponse.json({ error: 'Не удалось подтвердить подпись Telegram' }, { status: 401 })
  }

  const supabase = createServerSupabaseClient()
  const telegramUserId = verified.user?.id ?? null

  // Если у этого пользователя уже есть незавершённая сессия — продолжаем её,
  // а не начинаем квиз заново (человек мог случайно закрыть приложение).
  if (telegramUserId != null) {
    const { data: existing } = await supabase
      .from('shipments')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<Shipment>()

    if (existing) {
      try {
        const state = resolveQuizState(existing)
        if (state.question) {
          return NextResponse.json({ sessionId: existing.id, ...state })
        }
      } catch {
        // Сессия осталась от старой версии дерева вопросов (answers_log ссылается на несуществующий
        // question_id после переработки квиза) — не резюмируем её, начинаем новую сессию ниже.
      }
    }
  }

  // checkOnly используется лендингом только чтобы узнать, есть ли активная сессия —
  // без него мы бы создавали пустой shipment при каждом открытии главной страницы.
  if (checkOnly) {
    return NextResponse.json({ sessionId: null })
  }

  const { data, error } = await supabase
    .from('shipments')
    .insert({
      telegram_user_id: telegramUserId,
      telegram_username: verified.user?.username ?? null,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sessionId: data.id, question: getStartQuestion(), step: 0, history: [] })
}
