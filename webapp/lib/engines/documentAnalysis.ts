import 'server-only'

/**
 * AI-анализ вложения (инвойс/упаковочный лист) — свободный текстовый пересказ для логиста,
 * не структурированные поля (форматы документов слишком разные для жёсткой схемы на MVP).
 * Только изображения — PDF пока не конвертируем в картинку для vision-модели.
 */
export async function analyzeDocumentImage(imageUrl: string): Promise<string | null> {
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
        messages: [
          {
            role: 'system',
            content:
              'Ты помогаешь логисту быстро понять содержимое присланного документа (инвойс, упаковочный лист) для доставки груза из Китая.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Опиши коротко (3-5 строк): товар, количество, стоимость, поставщик — если видно на документе. Если текст не читается или это не инвойс/упаковочный лист, так и скажи.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
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
