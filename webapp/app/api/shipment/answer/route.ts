import { NextRequest, NextResponse, after } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { applyAnswer } from '@/lib/engines/shipmentEngine'
import { recalculateShipment } from '@/lib/engines/recalculate'
import { getQuestionNode, getNextQuestion } from '@/lib/engines/decisionEngine'
import { getAccuracyHint } from '@/lib/engines/recommendationEngine'
import { notifyLogist } from '@/lib/engines/logisticEngine'
import { analyzeAndVerifyProduct } from '@/lib/engines/aiProductAnalysis'
import { analyzeDocumentImage, analyzeDocumentText } from '@/lib/engines/documentAnalysis'
import { getSignedAttachmentUrl } from '@/lib/engines/attachmentStorage'
import { extractAttachmentText, TEXT_EXTRACTABLE_MIME_TYPES } from '@/lib/engines/attachmentText'
import { toPublicShipment } from '@/lib/types/publicShipment'
import type { Shipment } from '@/lib/types/shipment'

// Единое поле "название или ссылка" во всех ветках (tn.md) — после ответа запускаем AI-анализ
// товара: категорию для расчёта, код ТН ВЭД и документы/сертификацию теперь определяет AI,
// а не отдельные вопросы. Вложение (инвойс/упаковочный лист) — необязательная часть того же
// экрана (withAttachment), поэтому оба фоновых анализа триггерятся одним и тем же questionId.
const PRODUCT_QUESTION_IDS = new Set(['ct0_product', 'ct1_product', 'ct2_product'])

// Фоновый вызов AI (after()) продолжает работать после отправки ответа клиенту —
// даём функции запас времени сверх обычных секунд на сохранение в Supabase.
export const maxDuration = 30

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

  // AI-анализ товара (tn.md) — не блокирует ответ клиенту (сам запрос к LLM занимает секунды),
  // дозаполняется в фоне после отправки ответа: до вопросов про категорию/сертификацию ещё есть время.
  // Вложение (инвойс/упаковочный лист) — тот же фон: xlsx/csv/txt разбираются в текст и идут и в
  // классификацию товара, и в отдельный пересказ для логиста; фото — через vision. PDF и legacy .xls
  // пока не разбираются AI (остаются только файлом в заявке), см. attachmentText.ts.
  if (PRODUCT_QUESTION_IDS.has(questionId)) {
    const attachmentPath = recalculated.attachment_path
    const attachmentMimeType = recalculated.attachment_mime_type
    after(async () => {
      let attachmentText: string | null = null
      if (attachmentPath && attachmentMimeType && TEXT_EXTRACTABLE_MIME_TYPES.has(attachmentMimeType)) {
        try {
          attachmentText = await extractAttachmentText(attachmentPath, attachmentMimeType)
        } catch (err) {
          console.error('[shipment/answer] extractAttachmentText failed', err)
        }
      }

      const [analysis, attachmentSummary] = await Promise.all([
        analyzeAndVerifyProduct({
          category: recalculated.category,
          description: recalculated.product_description,
          referenceValue: recalculated.product_reference_value,
          attachmentText,
        }).catch((err) => {
          console.error('[shipment/answer] analyzeProduct background failed', err)
          return null
        }),
        (async () => {
          if (!attachmentPath || !attachmentMimeType) return null
          try {
            if (attachmentMimeType.startsWith('image/')) {
              const signedUrl = await getSignedAttachmentUrl(attachmentPath)
              return signedUrl ? await analyzeDocumentImage(signedUrl) : null
            }
            return attachmentText ? await analyzeDocumentText(attachmentText) : null
          } catch (err) {
            console.error('[shipment/answer] attachment summary background failed', err)
            return null
          }
        })(),
      ])

      const patch: Record<string, unknown> = {}
      if (analysis) {
        Object.assign(patch, {
          // category клиент больше не выбирает сам — если AI его не определил, не затираем null.
          ...(analysis.category ? { category: analysis.category } : {}),
          hs_code_suggested: analysis.hsCodeEntry ? analysis.hsCodeEntry.code : analysis.hsCode,
          hs_code_suggested_description: analysis.hsCodeEntry?.description ?? null,
          ai_confidence: analysis.confidence,
          ai_suggested_documents: analysis.documents,
          ai_suggested_non_tariff: analysis.nonTariffServices,
        })
      }
      if (attachmentSummary) patch.attachment_ai_summary = attachmentSummary

      if (Object.keys(patch).length > 0) {
        await supabase.from('shipments').update(patch).eq('id', sessionId)
      }
    })
  }

  const hint = getAccuracyHint(recalculated.calculation_accuracy ?? 'low', missingFieldLabels)

  return NextResponse.json({ nextQuestion, shipment: toPublicShipment(recalculated), hint })
}
