import type { Shipment } from '@/lib/types/shipment'
import { getPurposeLabel } from '@/lib/config/decisionTree'
import { ACCURACY_LABEL } from './recommendationEngine'
import { sendTelegramMessage } from '@/lib/telegram/sendMessage'

export const DELIVERY_MODE_LABEL: Record<string, string> = { cargo: 'Карго', white: 'Белая доставка' }
export const TEMPERATURE_EMOJI: Record<string, string> = { hot: '🔥', warm: '🙂', cold: '❄️' }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formatPrice(shipment: Shipment): string {
  if (shipment.estimated_price_min == null) return 'не рассчитана'
  return `${shipment.estimated_price_min.toLocaleString('ru-RU')}–${shipment.estimated_price_max?.toLocaleString('ru-RU')} ₽`
}

export function formatDays(shipment: Shipment): string | null {
  if (shipment.estimated_delivery_days_min == null) return null
  return `${shipment.estimated_delivery_days_min}–${shipment.estimated_delivery_days_max} дней`
}

/**
 * Собирает уже готовую заявку без повторного интервью клиента — вся модель Shipment
 * в одном читаемом сообщении для логиста/менеджера.
 */
export function buildLogistCardText(shipment: Shipment): string {
  const temperature = shipment.lead_temperature ?? 'cold'
  const lines: string[] = [`${TEMPERATURE_EMOJI[temperature]} Новая заявка — ${escapeHtml(getPurposeLabel(shipment.purpose))}`, '']

  if (shipment.category) lines.push(`Категория: ${escapeHtml(shipment.category)}`)
  if (shipment.product_description) lines.push(`Товар: ${escapeHtml(shipment.product_description)}`)
  if (shipment.supplier) lines.push(`Поставщик: ${escapeHtml(shipment.supplier)}`)
  if (shipment.origin_city) lines.push(`Откуда: ${escapeHtml(shipment.origin_city)}`)
  if (shipment.delivery_mode) lines.push(`Способ доставки: ${DELIVERY_MODE_LABEL[shipment.delivery_mode]}`)
  if (shipment.weight_kg != null) lines.push(`Вес: ${shipment.weight_kg} кг`)
  if (shipment.volume_m3 != null) lines.push(`Объём: ${shipment.volume_m3.toFixed(3)} м³`)
  if (shipment.product_cost != null) lines.push(`Стоимость товара: ${shipment.product_cost.toLocaleString('ru-RU')} ₽`)

  lines.push('')
  lines.push(`💰 Расчёт: ${formatPrice(shipment)} (${ACCURACY_LABEL[shipment.calculation_accuracy ?? 'low']})`)
  if (shipment.estimated_route) lines.push(`Маршрут: ${escapeHtml(shipment.estimated_route)}`)
  const days = formatDays(shipment)
  if (days) lines.push(`Срок: ${days}`)

  if (shipment.system_comments) {
    lines.push('')
    lines.push(`💬 ${escapeHtml(shipment.system_comments)}`)
  }

  lines.push('')
  lines.push(`Скоринг: ${shipment.lead_score} (${temperature})`)
  lines.push(
    shipment.telegram_username
      ? `Клиент: @${escapeHtml(shipment.telegram_username)}`
      : `Клиент: id${shipment.telegram_user_id ?? '—'}`,
  )

  return lines.join('\n')
}

export async function notifyLogist(shipment: Shipment): Promise<void> {
  const chatId = process.env.TELEGRAM_NOTIFY_CHAT_ID
  const text = buildLogistCardText(shipment)

  if (!chatId) {
    console.warn('[logisticEngine] TELEGRAM_NOTIFY_CHAT_ID не задан — уведомление не отправлено. Текст карточки:\n' + text)
    return
  }

  await sendTelegramMessage(chatId, text)
}
