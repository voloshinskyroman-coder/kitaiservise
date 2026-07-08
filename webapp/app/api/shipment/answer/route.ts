import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { applyAnswer } from '@/lib/engines/shipmentEngine'
import { recalculateShipment } from '@/lib/engines/recalculate'
import { getQuestionNode, getNextQuestion } from '@/lib/engines/decisionEngine'
import { getAccuracyHint } from '@/lib/engines/recommendationEngine'
import { notifyLogist } from '@/lib/engines/logisticEngine'
import { runProductAndAttachmentAnalysis } from '@/lib/engines/productAiPipeline'
import { toPublicShipment } from '@/lib/types/publicShipment'
import type { Shipment } from '@/lib/types/shipment'

// Единое поле "название или ссылка" во всех ветках (tn.md) — после ответа запускаем AI-анализ
// товара: категорию для расчёта, код ТН ВЭД и документы/сертификацию теперь определяет AI,
// а не отдельные вопросы. Вложение (инвойс/упаковочный лист) — необязательная часть того же
// экрана (withAttachment), поэтому оба фоновых анализа триггерятся одним и тем же questionId.
const PRODUCT_QUESTION_IDS = new Set(['ct0_product', 'ct1_product', 'ct2_product'])

// Классификация товара может делать повторный запрос (если код ТН ВЭД не нашёлся в справочнике)
// плюс параллельно разбирает вложение — с запасом даём до 60с, чтобы не резать фон раньше времени.
export const maxDuration = 60

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
    // Клиент видит "Заявка принята" сразу — но логиста уведомляем только после того, как AI
    // закончит (успешно или нет) разбор товара/вложения, чтобы карточка в Telegram приходила
    // с готовым кодом ТН ВЭД/документами, а не раньше времени. Если AI так и не ответит —
    // страховка: всё равно уведомляем логиста через runProductAndAttachmentAnalysis, просто
    // без AI-полей, чтобы лид не потерялся.
    after(async () => {
      try {
        let finalShipment = recalculated
        const needsAnalysis =
          finalShipment.ai_confidence == null &&
          Boolean(finalShipment.product_description || finalShipment.product_reference_value || finalShipment.attachment_path)

        if (needsAnalysis) {
          // Фоновый разбор мог уже завершиться на предыдущих шагах — проверяем актуальное состояние,
          // прежде чем запускать AI ещё раз.
          const { data: latest } = await supabase.from('shipments').select('*').eq('id', sessionId).single<Shipment>()
          if (latest) finalShipment = latest

          if (finalShipment.ai_confidence == null) {
            const patch = await runProductAndAttachmentAnalysis(sessionId, finalShipment)
            finalShipment = { ...finalShipment, ...patch } as Shipment
          }
        }

        await notifyLogist(finalShipment)
      } catch (err) {
        console.error('[shipment/answer] notifyLogist (post-AI) failed', err)
      }
    })
  }

  // AI-анализ товара (tn.md) — не блокирует ответ клиенту, дозаполняется в фоне сразу после вопроса
  // о товаре: даёт AI время, пока клиент отвечает на остальные вопросы (до уведомления логиста выше).
  if (PRODUCT_QUESTION_IDS.has(questionId)) {
    after(() =>
      runProductAndAttachmentAnalysis(sessionId, recalculated).catch((err) => {
        console.error('[shipment/answer] analyzeProduct background failed', err)
      }),
    )
  }

  const hint = getAccuracyHint(recalculated.calculation_accuracy ?? 'low', missingFieldLabels)

  return NextResponse.json({ nextQuestion, shipment: toPublicShipment(recalculated), hint })
}
