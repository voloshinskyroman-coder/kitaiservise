import 'server-only'

const SYSTEM_PROMPT =
  'Ты помогаешь логисту быстро понять содержимое присланного документа (инвойс, упаковочный лист) для доставки груза из Китая. Документ может быть на китайском или английском — переведи и перескажи по-русски.'

const INSTRUCTION =
  'Опиши коротко (3-5 строк): товар, количество, стоимость, поставщик — если видно в документе. Если это не похоже на инвойс/упаковочный лист или данные не читаются, так и скажи.'

async function summarize(messages: unknown[]): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.warn('[documentAnalysis] OPENROUTER_API_KEY не задан — анализ пропущен')
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'openai/gpt-5',
        messages,
        reasoning: { effort: 'low' },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[documentAnalysis] OpenRouter request failed: ${res.status} ${body}`)
      return null
    }

    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content
    return typeof text === 'string' && text.trim() ? text.trim() : null
  } catch (err) {
    console.error('[documentAnalysis] request error', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * AI-анализ вложения-изображения (инвойс/упаковочный лист) — свободный текстовый пересказ
 * для логиста, не структурированные поля (форматы документов слишком разные для жёсткой схемы на MVP).
 */
export async function analyzeDocumentImage(imageUrl: string): Promise<string | null> {
  return summarize([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: INSTRUCTION },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    },
  ])
}

/** Тот же пересказ, но для вложений с извлекаемым текстом (xlsx/csv/txt, см. attachmentText.ts). */
export async function analyzeDocumentText(text: string): Promise<string | null> {
  return summarize([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Содержимое файла:\n\n${text}\n\n${INSTRUCTION}` },
  ])
}
