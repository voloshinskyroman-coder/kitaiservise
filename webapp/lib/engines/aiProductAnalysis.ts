import 'server-only'
import { lookupHsCode, findCodesByHeading, type HsCodeEntry } from './hsCodeLookup'
import { CATEGORY_OPTIONS } from '@/lib/config/decisionTree'

// Значения должны совпадать с DOCUMENTS_WHITE_OPTIONS / NON_TARIFF_OPTIONS / CATEGORY_OPTIONS
// в decisionTree.ts — это то, что реально можно сохранить в Shipment и предзаполнить в квизе.
const DOCUMENT_VALUES = ['invoice', 'packing_list', 'contract', 'hs_code', 'certificates', 'none'] as const
const NON_TARIFF_VALUES = ['ds', 'sstc', 'ru', 'sgr', 'eac', 'chestny_znak', 'unknown'] as const
const CATEGORY_VALUES = CATEGORY_OPTIONS.map((o) => o.value)

export interface ProductAnalysisResult {
  category: string | null
  hsCode: string | null
  confidence: number | null
  documents: string[]
  nonTariffServices: string[]
}

const CLASSIFY_TOOL = {
  type: 'function',
  function: {
    name: 'classify_product',
    description: 'Классифицирует товар для таможенного оформления при ввозе в РФ из Китая',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORY_VALUES, description: 'Категория товара — наиболее подходящий вариант из списка' },
        hs_code: { type: 'string', description: 'Наиболее вероятный код ТН ВЭД ЕАЭС — ровно 10 цифр без точек и пробелов, например 6109100000' },
        confidence: {
          type: 'number',
          description: 'Уверенность в определении кода и требований — целое число от 0 до 100 (например 85), не дробь от 0 до 1',
        },
        documents: {
          type: 'array',
          items: { type: 'string', enum: DOCUMENT_VALUES },
          description: 'Какие документы обычно нужны для этого товара при официальной (белой) доставке',
        },
        non_tariff_services: {
          type: 'array',
          items: { type: 'string', enum: NON_TARIFF_VALUES },
          description: 'Какая сертификация или маркировка обычно требуется для этого товара',
        },
      },
      required: ['category', 'hs_code', 'confidence', 'documents', 'non_tariff_services'],
    },
  },
} as const

function filterKnownValues(values: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(values)) return []
  return values.filter((v): v is string => typeof v === 'string' && allowed.includes(v))
}

/**
 * Приблизительная AI-классификация товара (категория/код ТН ВЭД/документы/сертификация) —
 * MVP-замена внешнему API определения ТН ВЭД (см. tn.md). Логист проверяет и подтверждает
 * перед реальным оформлением, поэтому ошибка здесь не критична — при сбое просто возвращаем null
 * и квиз продолжается как обычно, без предзаполненных чек-листов.
 */
export async function analyzeProduct(input: {
  category: string | null
  description: string | null
  referenceValue: string | null
  /** Текст, извлечённый из вложения (инвойс/упаковочный лист) — см. attachmentText.ts. Может быть на китайском. */
  attachmentText?: string | null
  /** Заполняется при повторной попытке — например, если предыдущий код не нашёлся в официальном классификаторе. */
  retryNote?: string
}): Promise<ProductAnalysisResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('[aiProductAnalysis] OPENROUTER_API_KEY не задан — анализ пропущен')
    return null
  }

  const parts = [
    input.category ? `Категория: ${input.category}` : null,
    input.description ? `Описание товара: ${input.description}` : null,
    input.referenceValue ? `Ссылка на товар: ${input.referenceValue}` : null,
    input.attachmentText ? `Данные из вложения (инвойс/упаковочный лист, может быть на китайском):\n${input.attachmentText}` : null,
    input.retryNote ? `\n${input.retryNote}` : null,
  ].filter((p): p is string => Boolean(p))

  if (parts.length === 0) return null

  const controller = new AbortController()
  // GPT-5 в среднем отвечает за 16-20с даже при low reasoning effort (замеряно вживую) —
  // 15с обрывал запросы раньше, чем модель успевала ответить (см. реальный случай "Футболка").
  const timeout = setTimeout(() => controller.abort(), 25_000)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai/gpt-5',
        messages: [
          {
            role: 'system',
            content:
              'Ты помогаешь предварительно классифицировать товары, ввозимые из Китая в Россию, для оценки таможенного оформления. Это приблизительная оценка для клиента и логиста — не окончательное решение.',
          },
          { role: 'user', content: parts.join('\n') },
        ],
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: 'function', function: { name: 'classify_product' } },
        // Классификация — простая задача, глубокое рассуждение не нужно и сильно замедляет ответ клиенту.
        reasoning: { effort: 'low' },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[aiProductAnalysis] OpenRouter request failed: ${res.status} ${body}`)
      return null
    }

    const data = await res.json()
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall?.function?.arguments) {
      console.error('[aiProductAnalysis] no tool call in response', JSON.stringify(data).slice(0, 500))
      return null
    }

    const parsed = JSON.parse(toolCall.function.arguments)
    // Модели иногда возвращают уверенность долей (0.84) вместо процента, несмотря на описание в схеме — нормализуем.
    const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : null
    const confidence = rawConfidence == null ? null : Math.max(0, Math.min(100, Math.round(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)))
    const hsCode = typeof parsed.hs_code === 'string' ? parsed.hs_code.replace(/[^\d]/g, '') : ''
    const category = typeof parsed.category === 'string' && CATEGORY_VALUES.includes(parsed.category) ? parsed.category : null

    return {
      category,
      hsCode: hsCode || null,
      confidence,
      documents: filterKnownValues(parsed.documents, DOCUMENT_VALUES),
      nonTariffServices: filterKnownValues(parsed.non_tariff_services, NON_TARIFF_VALUES),
    }
  } catch (err) {
    console.error('[aiProductAnalysis] request error', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export interface VerifiedProductAnalysis extends ProductAnalysisResult {
  /** Найден ли hsCode в официальном классификаторе (hs_codes). Официальное наименование — hsCodeEntry.description. */
  hsCodeEntry: HsCodeEntry | null
}

/**
 * Как analyzeProduct, но код ТН ВЭД дополнительно сверяется с официальным классификатором
 * (см. tn.md, scripts/seed-hs-codes.mjs) — если AI придумал несуществующий код (часто —
 * реальная товарная позиция, но с нулями вместо точного 10-значного листа), даём ему реальные
 * варианты кодов из той же позиции вместо слепой повторной попытки.
 */
export async function analyzeAndVerifyProduct(input: {
  category: string | null
  description: string | null
  referenceValue: string | null
  attachmentText?: string | null
}): Promise<VerifiedProductAnalysis | null> {
  const analysis = await analyzeProduct(input)
  if (!analysis) return null

  let hsCodeEntry = await lookupHsCode(analysis.hsCode)
  if (hsCodeEntry || !analysis.hsCode) {
    return { ...analysis, hsCodeEntry }
  }

  const candidates = await findCodesByHeading(analysis.hsCode)
  const retryNote =
    candidates.length > 0
      ? `Код ${analysis.hsCode} не найден в официальном классификаторе ТН ВЭД ЕАЭС. Вот реальные коды из этой товарной позиции — выбери наиболее подходящий (или другой реальный код, если ни один не подходит):\n${candidates
          .map((c) => `${c.code} — ${c.description}`)
          .join('\n')}`
      : `Код ${analysis.hsCode} не найден в официальном классификаторе ТН ВЭД ЕАЭС. Предложи другой, реально существующий 10-значный код.`

  const retry = await analyzeProduct({ ...input, retryNote })
  if (!retry) return { ...analysis, hsCodeEntry: null }

  hsCodeEntry = await lookupHsCode(retry.hsCode)
  return { ...retry, hsCodeEntry }
}
