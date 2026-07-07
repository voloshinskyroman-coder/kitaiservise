import type { Shipment } from '@/lib/types/shipment'
import {
  getPurposeLabel,
  labelsForValues,
  ALL_DOCUMENT_OPTIONS,
  EXTRA_SERVICES_OPTIONS,
  NON_TARIFF_OPTIONS,
  LOGISTICS_METHOD_OPTIONS,
} from '@/lib/config/decisionTree'
import { ACCURACY_LABEL } from './recommendationEngine'
import { sendTelegramMessage } from '@/lib/telegram/sendMessage'
import {
  DELIVERY_MODE_LABEL,
  TEMPERATURE_EMOJI,
  READINESS_LABEL,
  PRIOR_EXPERIENCE_LABEL,
  CLIENT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  CONTRACT_HOLDER_LABEL,
  DESTINATION_TYPE_LABEL,
  URGENCY_LABEL,
  formatPrice,
  formatDays,
} from './logisticLabels'

export {
  DELIVERY_MODE_LABEL,
  TEMPERATURE_EMOJI,
  READINESS_LABEL,
  PRIOR_EXPERIENCE_LABEL,
  CLIENT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  CONTRACT_HOLDER_LABEL,
  DESTINATION_TYPE_LABEL,
  URGENCY_LABEL,
  formatPrice,
  formatDays,
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Собирает уже готовую заявку без повторного интервью клиента — вся модель Shipment
 * в одном читаемом сообщении для логиста/менеджера. Состав полей — по ТЗ ("КАРТОЧКА ЛИДА ДЛЯ ЛОГИСТА").
 */
export function buildLogistCardText(shipment: Shipment): string {
  const temperature = shipment.lead_temperature ?? 'cold'
  const lines: string[] = [`${TEMPERATURE_EMOJI[temperature]} Новая заявка — ${escapeHtml(getPurposeLabel(shipment.purpose))}`, '']

  if (shipment.client_type != null) lines.push(`Тип клиента: ${CLIENT_TYPE_LABEL[shipment.client_type]}`)
  if (shipment.prior_experience) lines.push(`Опыт с Китаем: ${PRIOR_EXPERIENCE_LABEL[shipment.prior_experience]}`)
  if (shipment.category) lines.push(`Категория: ${escapeHtml(shipment.category)}`)
  if (shipment.product_description) lines.push(`Товар: ${escapeHtml(shipment.product_description)}`)
  if (shipment.supplier) lines.push(`Поставщик: ${escapeHtml(shipment.supplier)}`)
  if (shipment.payment_method) lines.push(`Способ оплаты: ${PAYMENT_METHOD_LABEL[shipment.payment_method] ?? shipment.payment_method}`)
  if (shipment.needs_money_transfer) lines.push('Нужен перевод денег поставщику: да')
  if (shipment.origin_city) lines.push(`Откуда: ${escapeHtml(shipment.origin_city)}`)
  if (shipment.destination_type) lines.push(`Куда доставить: ${DESTINATION_TYPE_LABEL[shipment.destination_type]}`)
  if (shipment.destination_city) lines.push(`Город доставки: ${escapeHtml(shipment.destination_city)}`)
  if (shipment.delivery_mode) lines.push(`Способ доставки: ${DELIVERY_MODE_LABEL[shipment.delivery_mode]}`)
  if (shipment.weight_kg != null) lines.push(`Вес: ${shipment.weight_kg} кг`)
  if (shipment.volume_m3 != null) lines.push(`Объём: ${shipment.volume_m3.toFixed(3)} м³`)
  if (shipment.package_count != null) lines.push(`Количество мест: ${shipment.package_count}`)
  if (shipment.product_cost != null) {
    lines.push(`Стоимость товара: ${shipment.product_cost.toLocaleString('ru-RU')} ${shipment.currency ?? 'RUB'}`)
  }
  if (shipment.purchase_budget != null) lines.push(`Бюджет на закупку: ${shipment.purchase_budget.toLocaleString('ru-RU')} ₽`)
  if (shipment.urgency) lines.push(`Срочность: ${URGENCY_LABEL[shipment.urgency]}`)
  if (shipment.cargo_readiness) lines.push(`Готовность груза: ${READINESS_LABEL[shipment.cargo_readiness]}`)
  if (shipment.documents.length > 0) {
    lines.push(`Документы: ${labelsForValues(ALL_DOCUMENT_OPTIONS, shipment.documents).map(escapeHtml).join(', ')}`)
  }
  if (shipment.non_tariff_services.length > 0) {
    lines.push(`Сертификаты/маркировка: ${labelsForValues(NON_TARIFF_OPTIONS, shipment.non_tariff_services).map(escapeHtml).join(', ')}`)
  }
  if (shipment.hs_code_suggested) {
    const verified = shipment.hs_code_suggested_description ? ' ✅ сверен с классификатором ФНС' : ' ⚠️ не найден в классификаторе'
    lines.push(
      `🤖 AI: код ТН ВЭД ${escapeHtml(shipment.hs_code_suggested)}${shipment.ai_confidence != null ? ` (увер. ${shipment.ai_confidence}%)` : ''}${verified} — требует подтверждения логистом`,
    )
    if (shipment.hs_code_suggested_description) lines.push(`   ${escapeHtml(shipment.hs_code_suggested_description)}`)
  }
  if (shipment.customs_contract_holder) {
    lines.push(`Контракт оформления: ${CONTRACT_HOLDER_LABEL[shipment.customs_contract_holder]}`)
  }
  if (shipment.logistics_method) {
    lines.push(`Способ логистики: ${labelsForValues(LOGISTICS_METHOD_OPTIONS, [shipment.logistics_method])[0]}`)
  }
  if (shipment.extra_services.length > 0) {
    lines.push(`Доп. услуги: ${labelsForValues(EXTRA_SERVICES_OPTIONS, shipment.extra_services).map(escapeHtml).join(', ')}`)
  }

  lines.push('')
  lines.push(`💰 Расчёт: ${formatPrice(shipment)} (${ACCURACY_LABEL[shipment.calculation_accuracy ?? 'low']})`)
  if (shipment.estimated_route) lines.push(`Маршрут: ${escapeHtml(shipment.estimated_route)}`)
  const days = formatDays(shipment)
  if (days) lines.push(`Срок: ${days}`)

  if (shipment.client_comment) {
    lines.push('')
    lines.push(`📝 Комментарий клиента: ${escapeHtml(shipment.client_comment)}`)
  }

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
