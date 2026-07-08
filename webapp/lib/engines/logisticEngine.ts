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
import { sendTelegramMessage, sendTelegramDocument } from '@/lib/telegram/sendMessage'
import { getSignedAttachmentUrl } from './attachmentStorage'
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
  const lines: string[] = [`${TEMPERATURE_EMOJI[temperature]} <b>Новая заявка — ${escapeHtml(getPurposeLabel(shipment.purpose))}</b>`, '']

  const clientLines: string[] = []
  if (shipment.client_type != null) clientLines.push(`<b>Тип клиента:</b> ${CLIENT_TYPE_LABEL[shipment.client_type]}`)
  if (shipment.prior_experience) clientLines.push(`<b>Опыт с Китаем:</b> ${PRIOR_EXPERIENCE_LABEL[shipment.prior_experience]}`)
  if (clientLines.length > 0) lines.push('👤 <b>Клиент</b>', ...clientLines, '')

  const productLines: string[] = []
  if (shipment.category) productLines.push(`<b>Категория:</b> ${escapeHtml(shipment.category)}`)
  if (shipment.product_description) productLines.push(`<b>Товар:</b> ${escapeHtml(shipment.product_description)}`)
  if (shipment.supplier) productLines.push(`<b>Поставщик:</b> ${escapeHtml(shipment.supplier)}`)
  if (productLines.length > 0) lines.push('📦 <b>Товар</b>', ...productLines, '')

  const paymentLines: string[] = []
  if (shipment.payment_method) paymentLines.push(`<b>Способ оплаты:</b> ${PAYMENT_METHOD_LABEL[shipment.payment_method] ?? shipment.payment_method}`)
  if (shipment.needs_money_transfer) paymentLines.push('<b>Нужен перевод денег поставщику:</b> да')
  if (shipment.origin_city) paymentLines.push(`<b>Откуда:</b> ${escapeHtml(shipment.origin_city)}`)
  if (shipment.destination_type) paymentLines.push(`<b>Куда доставить:</b> ${DESTINATION_TYPE_LABEL[shipment.destination_type]}`)
  if (shipment.destination_city) paymentLines.push(`<b>Город доставки:</b> ${escapeHtml(shipment.destination_city)}`)
  if (shipment.delivery_mode) paymentLines.push(`<b>Способ доставки:</b> ${DELIVERY_MODE_LABEL[shipment.delivery_mode]}`)
  if (paymentLines.length > 0) lines.push('🚚 <b>Оплата и доставка</b>', ...paymentLines, '')

  const cargoLines: string[] = []
  if (shipment.weight_kg != null) cargoLines.push(`<b>Вес:</b> ${shipment.weight_kg} кг`)
  if (shipment.volume_m3 != null) cargoLines.push(`<b>Объём:</b> ${shipment.volume_m3.toFixed(3)} м³`)
  if (shipment.package_count != null) cargoLines.push(`<b>Количество мест:</b> ${shipment.package_count}`)
  if (shipment.product_cost != null) {
    cargoLines.push(`<b>Стоимость товара:</b> ${shipment.product_cost.toLocaleString('ru-RU')} ${shipment.currency ?? 'RUB'}`)
  }
  if (shipment.purchase_budget != null) cargoLines.push(`<b>Бюджет на закупку:</b> ${shipment.purchase_budget.toLocaleString('ru-RU')} ₽`)
  if (shipment.urgency) cargoLines.push(`<b>Срочность:</b> ${URGENCY_LABEL[shipment.urgency]}`)
  if (shipment.cargo_readiness) cargoLines.push(`<b>Готовность груза:</b> ${READINESS_LABEL[shipment.cargo_readiness]}`)
  if (cargoLines.length > 0) lines.push('📐 <b>Параметры груза</b>', ...cargoLines, '')

  const docsLines: string[] = []
  if (shipment.documents.length > 0) {
    docsLines.push(`<b>Документы:</b> ${labelsForValues(ALL_DOCUMENT_OPTIONS, shipment.documents).map(escapeHtml).join(', ')}`)
  }
  if (shipment.non_tariff_services.length > 0) {
    docsLines.push(`<b>Сертификаты/маркировка:</b> ${labelsForValues(NON_TARIFF_OPTIONS, shipment.non_tariff_services).map(escapeHtml).join(', ')}`)
  }
  if (shipment.customs_contract_holder) {
    docsLines.push(`<b>Контракт оформления:</b> ${CONTRACT_HOLDER_LABEL[shipment.customs_contract_holder]}`)
  }
  if (shipment.logistics_method) {
    docsLines.push(`<b>Способ логистики:</b> ${labelsForValues(LOGISTICS_METHOD_OPTIONS, [shipment.logistics_method])[0]}`)
  }
  if (shipment.extra_services.length > 0) {
    docsLines.push(`<b>Доп. услуги:</b> ${labelsForValues(EXTRA_SERVICES_OPTIONS, shipment.extra_services).map(escapeHtml).join(', ')}`)
  }
  if (docsLines.length > 0) lines.push('📄 <b>Документы и услуги</b>', ...docsLines, '')

  if (shipment.hs_code_suggested) {
    const verified = shipment.hs_code_suggested_description ? '✅ сверен с классификатором ФНС' : '⚠️ не найден в классификаторе'
    lines.push('🤖 <b>AI-классификация</b>')
    lines.push(
      `<b>Код ТН ВЭД:</b> ${escapeHtml(shipment.hs_code_suggested)}${shipment.ai_confidence != null ? ` (увер. ${shipment.ai_confidence}%)` : ''} ${verified}`,
    )
    if (shipment.hs_code_suggested_description) lines.push(escapeHtml(shipment.hs_code_suggested_description))
    lines.push('<i>Требует подтверждения логистом</i>', '')
  }

  lines.push('💰 <b>Расчёт</b>')
  lines.push(`<b>Стоимость:</b> ${formatPrice(shipment)} (${ACCURACY_LABEL[shipment.calculation_accuracy ?? 'low']})`)
  if (shipment.estimated_route) lines.push(`<b>Маршрут:</b> ${escapeHtml(shipment.estimated_route)}`)
  const days = formatDays(shipment)
  if (days) lines.push(`<b>Срок:</b> ${days}`)
  lines.push('')

  if (shipment.attachment_path) {
    lines.push('📎 <b>Вложение</b>')
    lines.push('Инвойс/упаковочный лист (файлом ниже)')
    if (shipment.attachment_ai_summary) lines.push(`🤖 ${escapeHtml(shipment.attachment_ai_summary)}`)
    lines.push('')
  }

  if (shipment.client_comment) {
    lines.push('📝 <b>Комментарий клиента</b>')
    lines.push(escapeHtml(shipment.client_comment))
    lines.push('')
  }

  if (shipment.system_comments) {
    lines.push(`💬 ${escapeHtml(shipment.system_comments)}`, '')
  }

  lines.push(`<b>Скоринг:</b> ${shipment.lead_score} (${temperature})`)
  lines.push(
    shipment.telegram_username
      ? `<b>Клиент:</b> @${escapeHtml(shipment.telegram_username)}`
      : `<b>Клиент:</b> id${shipment.telegram_user_id ?? '—'}`,
  )

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function notifyLogist(shipment: Shipment): Promise<void> {
  const chatId = process.env.TELEGRAM_NOTIFY_CHAT_ID
  const text = buildLogistCardText(shipment)

  if (!chatId) {
    console.warn('[logisticEngine] TELEGRAM_NOTIFY_CHAT_ID не задан — уведомление не отправлено. Текст карточки:\n' + text)
    return
  }

  await sendTelegramMessage(chatId, text)

  if (shipment.attachment_path) {
    const signedUrl = await getSignedAttachmentUrl(shipment.attachment_path)
    if (signedUrl) {
      await sendTelegramDocument(chatId, signedUrl, 'Инвойс/упаковочный лист к заявке выше')
    } else {
      console.error('[logisticEngine] не удалось получить подписанную ссылку на вложение', shipment.attachment_path)
    }
  }
}
