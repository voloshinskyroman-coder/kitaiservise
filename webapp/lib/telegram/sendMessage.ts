import 'server-only'

/** Отправляет сообщение через Bot API. Ошибки логируются, но не выбрасываются — уведомления не критичны для основного флоу. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — сообщение не отправлено')
    return
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[telegram] sendMessage failed: ${res.status} ${body}`)
  }
}

/** Отправляет файл по ссылке (Telegram сам скачивает по URL — подходит для подписанных Storage-ссылок). */
export async function sendTelegramDocument(chatId: string, documentUrl: string, caption?: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — документ не отправлен')
    return
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, document: documentUrl, caption, parse_mode: 'HTML' }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[telegram] sendDocument failed: ${res.status} ${body}`)
  }
}
