import type { Shipment } from '@/lib/types/shipment'

// Чистые лейблы/форматтеры без server-only зависимостей — безопасно импортировать в клиентские компоненты.
export const DELIVERY_MODE_LABEL: Record<string, string> = {
  cargo: 'Карго',
  white: 'Белая доставка',
  docs_only: 'Только документы/оформление',
}
export const TEMPERATURE_EMOJI: Record<string, string> = { hot: '🔥', warm: '🙂', cold: '❄️' }
export const READINESS_LABEL: Record<string, string> = {
  ready: 'уже готов',
  week: 'через неделю',
  month: 'через месяц',
  unknown: 'пока неизвестно',
}
export const PRIOR_EXPERIENCE_LABEL: Record<string, string> = {
  white: 'возил белой доставкой',
  cargo: 'возил карго',
  none: 'первый раз',
}
export const CLIENT_TYPE_LABEL: Record<number, string> = {
  0: '0 — полный цикл поставки',
  1: '1 — нашёл товар',
  2: '2 — товар уже куплен',
  3: '3 — отдельные услуги',
}
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  self_invoice: 'самостоятельно поставщику',
  to_our_cn_company: 'через нашу компанию в Китае',
  agent_agreement_rf: 'через агентский договор в РФ',
  to_our_rf_company: 'через российскую компанию',
  // старые значения — на случай уже сохранённых заявок с прошлой версией вопроса.
  via_our_cn_company: 'через нашу китайскую компанию',
  purchase_via_rf_company: 'купля-продажа через компанию РФ',
  consultation: 'не знает, нужна консультация',
  self_invoice_to_supplier: 'сам, по инвойсу поставщику в Китае',
}
export const CONTRACT_HOLDER_LABEL: Record<string, string> = {
  us: 'на наш контракт',
  client: 'на контракт клиента',
  unknown: 'не знает',
}
export const DESTINATION_TYPE_LABEL: Record<string, string> = {
  city: 'город РФ',
  warehouse: 'до склада',
  door: 'до двери',
  not_needed: 'доставка не нужна',
}
export const URGENCY_LABEL: Record<string, string> = {
  urgent: 'срочно',
  month: 'в течение месяца',
  not_urgent: 'не срочно',
}

export function formatPrice(shipment: Shipment): string {
  if (shipment.estimated_price_min == null) return 'не рассчитана'
  return `${shipment.estimated_price_min.toLocaleString('ru-RU')}–${shipment.estimated_price_max?.toLocaleString('ru-RU')} ₽`
}

export function formatDays(shipment: Shipment): string | null {
  if (shipment.estimated_delivery_days_min == null) return null
  return `${shipment.estimated_delivery_days_min}–${shipment.estimated_delivery_days_max} дней`
}
