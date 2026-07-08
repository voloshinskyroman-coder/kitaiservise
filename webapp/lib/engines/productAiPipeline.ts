import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { analyzeAndVerifyProduct } from './aiProductAnalysis'
import { analyzeDocumentImage, analyzeDocumentText } from './documentAnalysis'
import { getSignedAttachmentUrl } from './attachmentStorage'
import { extractAttachmentText, TEXT_EXTRACTABLE_MIME_TYPES } from './attachmentText'
import { extractPdfText } from './pdfText'

interface AnalyzableShipment {
  category: string | null
  product_description: string | null
  product_reference_value: string | null
  attachment_path: string | null
  attachment_mime_type: string | null
}

/**
 * Разбор товара (категория/код ТН ВЭД/документы) и вложения (пересказ инвойса) — общая логика.
 * Запускается дважды по смыслу (см. shipment/answer/route.ts): как фоновый "разогрев" сразу после
 * вопроса о товаре (даёт AI время, пока клиент отвечает на остальные вопросы), и как обязательный
 * шаг перед уведомлением логиста, если фон ещё не успел — чтобы карточка в Telegram не уходила
 * с пустыми AI-полями. Пишет результат в БД и возвращает применённый патч.
 */
export async function runProductAndAttachmentAnalysis(
  sessionId: string,
  shipment: AnalyzableShipment,
): Promise<Record<string, unknown>> {
  const supabase = createServerSupabaseClient()
  const { attachment_path: attachmentPath, attachment_mime_type: attachmentMimeType } = shipment

  let attachmentText: string | null = null
  if (attachmentPath && attachmentMimeType) {
    try {
      if (TEXT_EXTRACTABLE_MIME_TYPES.has(attachmentMimeType)) {
        attachmentText = await extractAttachmentText(attachmentPath, attachmentMimeType)
      } else if (attachmentMimeType === 'application/pdf') {
        attachmentText = await extractPdfText(attachmentPath)
      }
    } catch (err) {
      console.error('[productAiPipeline] extract attachment text failed', err)
    }
  }

  const [analysis, attachmentSummary] = await Promise.all([
    analyzeAndVerifyProduct({
      category: shipment.category,
      description: shipment.product_description,
      referenceValue: shipment.product_reference_value,
      attachmentText,
    }).catch((err) => {
      console.error('[productAiPipeline] analyzeProduct failed', err)
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
        console.error('[productAiPipeline] attachment summary failed', err)
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

  return patch
}
