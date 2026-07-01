import type { Shipment, LeadTemperature } from '@/lib/types/shipment'

// "Просто интересуется"/"ещё ищет" явно понижают скоринг по документу (нет найденного поставщика).
// Уже купленный товар, готовность платить и повторные клиенты (переход на белую) — сильные сигналы намерения.
const SCENARIO_BASE_SCORE: Record<string, number> = {
  already_bought: 10,
  need_purchase: 0,
  searching: -5,
  money_transfer: 15,
  cargo_to_white: 15,
  just_curious: -15,
}

const UNKNOWN_ANSWER_VALUES = new Set(['unknown'])
const UNKNOWN_ANSWER_PENALTY = 10

const HOT_THRESHOLD = 30
const WARM_THRESHOLD = 0

export type ScoringPatch = Pick<Shipment, 'lead_score' | 'lead_temperature'>

/**
 * Оценивает качество лида после каждого ответа. Статус скрыт от пользователя,
 * виден только в админке/карточке логиста.
 */
export function recalculateLeadScore(shipment: Shipment): ScoringPatch {
  let score = SCENARIO_BASE_SCORE[shipment.scenario ?? ''] ?? 0

  if (shipment.category != null) score += 5
  if (shipment.product_description != null) score += 5
  if (shipment.origin_city != null) score += 5
  if (shipment.supplier != null) score += 10
  if (shipment.product_cost != null) score += 10
  if (shipment.weight_kg != null) score += 10
  if (shipment.volume_m3 != null) score += 10
  if (shipment.delivery_mode != null) score += 5
  if (shipment.payment_status === 'paid') score += 15
  if (shipment.supplier_status === 'ready') score += 10
  if (shipment.documents.length > 0) score += 10

  const unknownAnswers = shipment.answers_log.filter((entry) => UNKNOWN_ANSWER_VALUES.has(String(entry.answer))).length
  score -= unknownAnswers * UNKNOWN_ANSWER_PENALTY

  const lead_temperature: LeadTemperature = score >= HOT_THRESHOLD ? 'hot' : score >= WARM_THRESHOLD ? 'warm' : 'cold'

  return { lead_score: score, lead_temperature }
}
