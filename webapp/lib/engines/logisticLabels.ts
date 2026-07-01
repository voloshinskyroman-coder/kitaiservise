import type { Shipment } from '@/lib/types/shipment'

// Чистые лейблы/форматтеры без server-only зависимостей — безопасно импортировать в клиентские компоненты.
export const DELIVERY_MODE_LABEL: Record<string, string> = { cargo: 'Карго', white: 'Белая доставка' }
export const TEMPERATURE_EMOJI: Record<string, string> = { hot: '🔥', warm: '🙂', cold: '❄️' }

export function formatPrice(shipment: Shipment): string {
  if (shipment.estimated_price_min == null) return 'не рассчитана'
  return `${shipment.estimated_price_min.toLocaleString('ru-RU')}–${shipment.estimated_price_max?.toLocaleString('ru-RU')} ₽`
}

export function formatDays(shipment: Shipment): string | null {
  if (shipment.estimated_delivery_days_min == null) return null
  return `${shipment.estimated_delivery_days_min}–${shipment.estimated_delivery_days_max} дней`
}
