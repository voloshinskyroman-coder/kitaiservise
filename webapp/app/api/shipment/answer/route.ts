import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { applyAnswer } from '@/lib/engines/shipmentEngine'
import { recalculateShipment } from '@/lib/engines/recalculate'
import { getQuestionNode, getNextQuestion } from '@/lib/engines/decisionEngine'
import { getAccuracyHint } from '@/lib/engines/recommendationEngine'
import { notifyLogist } from '@/lib/engines/logisticEngine'
import { toPublicShipment } from '@/lib/types/publicShipment'
import type { Shipment } from '@/lib/types/shipment'

export async function POST(req: NextRequest) {
  const { sessionId, questionId, answer } = (await req.json()) as {
    sessionId?: string
    questionId?: string
    answer?: string
  }

  if (!sessionId || !questionId || answer == null) {
    return NextResponse.json({ error: 'sessionId, questionId и answer обязательны' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()
  const { data: shipment, error: loadError } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', sessionId)
    .single<Shipment>()

  if (loadError || !shipment) {
    return NextResponse.json({ error: 'Сессия не найдена' }, { status: 404 })
  }

  if (shipment.status === 'completed') {
    return NextResponse.json({ error: 'Квиз уже завершён' }, { status: 409 })
  }

  const node = getQuestionNode(questionId)
  const updated = applyAnswer(shipment, node, answer)
  const nextQuestion = getNextQuestion(node, updated, answer)
  const { shipment: recalculated, missingFieldLabels } = recalculateShipment(updated)

  if (!nextQuestion) {
    recalculated.status = 'completed'
  }

  const { error: saveError } = await supabase.from('shipments').update(recalculated).eq('id', sessionId)
  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  if (!nextQuestion) {
    // Уведомление логиста не должно ломать ответ пользователю, если Telegram недоступен.
    try {
      await notifyLogist(recalculated)
    } catch (err) {
      console.error('[shipment/answer] notifyLogist failed', err)
    }
  }

  const hint = getAccuracyHint(recalculated.calculation_accuracy ?? 'low', missingFieldLabels)

  return NextResponse.json({ nextQuestion, shipment: toPublicShipment(recalculated), hint })
}
