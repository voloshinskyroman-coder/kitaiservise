import type { Shipment, LeadTemperature } from '@/lib/types/shipment'

// client_type: 0 — полный цикл поставки (товар/поставщик ещё не найден — холоднее),
// 1 — нашёл товар, 2 — товар уже куплен (самый горячий сигнал), 3 — отдельные услуги (часто просто консультация).
const CLIENT_TYPE_BASE_SCORE: Record<number, number> = {
  0: -5,
  1: 10,
  2: 20,
  3: -10,
}

const UNKNOWN_ANSWER_VALUES = new Set(['unknown'])
const UNKNOWN_ANSWER_PENALTY = 10

const HOT_THRESHOLD = 30
const WARM_THRESHOLD = 0

export type ScoringPatch = Pick<Shipment, 'lead_score' | 'lead_temperature'>

/**
 * Оценивает качество лида после каждого ответа. Статус скрыт от пользователя,
 * виден только в админке/карточке логиста. Критерии соответствуют ТЗ:
 * горячий — товар найден/куплен, известны вес/объём/стоимость, груз готов, есть документы;
 * тёплый — товар найден, часть данных известна, нужна помощь с оплатой/оформлением;
 * холодный — товара пока нет, мало данных, просто консультация.
 */
export function recalculateLeadScore(shipment: Shipment): ScoringPatch {
  let score = CLIENT_TYPE_BASE_SCORE[shipment.client_type ?? 3] ?? 0

  if (shipment.category != null) score += 5
  if (shipment.weight_kg != null) score += 10
  if (shipment.volume_m3 != null) score += 10
  if (shipment.product_cost != null) score += 10
  if (shipment.delivery_mode != null) score += 10
  if (shipment.cargo_readiness === 'ready') score += 10
  if (shipment.documents.length > 0) score += 10
  if (shipment.needs_supplier_search === false) score += 5
  if (shipment.needs_money_transfer) score += 5
  if (shipment.urgency === 'urgent') score += 10

  // "Нужна отдельная услуга" почти всегда означает просто консультацию без конкретики.
  if (shipment.separate_services.length === 1 && shipment.separate_services.includes('consultation')) {
    score -= 10
  }

  const unknownAnswers = shipment.answers_log.filter((entry) => UNKNOWN_ANSWER_VALUES.has(String(entry.answer))).length
  score -= unknownAnswers * UNKNOWN_ANSWER_PENALTY

  const lead_temperature: LeadTemperature = score >= HOT_THRESHOLD ? 'hot' : score >= WARM_THRESHOLD ? 'warm' : 'cold'

  return { lead_score: score, lead_temperature }
}
