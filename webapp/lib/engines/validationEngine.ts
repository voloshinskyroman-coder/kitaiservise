import type { Shipment, CalculationAccuracy } from '@/lib/types/shipment'

// Без веса/объёма расчёт превращается в угадывание по категории — это критично для точности.
// Остальные поля лишь уточняют оценку. Стоимость товара нигде не входит в уточняющие поля,
// кроме белой доставки — в остальных случаях вопрос помечен опциональным (optional: true
// в decisionTree), не наказываем за пропуск.
type RefiningFieldsFn = (shipment: Shipment) => (keyof Shipment)[]

function refiningFieldsForShipping(s: Shipment): (keyof Shipment)[] {
  const fields: (keyof Shipment)[] = ['category', 'destination_city']
  if (s.delivery_mode == null) fields.push('delivery_mode')
  if (s.delivery_mode === 'white') fields.push('product_cost')
  return fields
}

// client_type 0 обрабатывается отдельно в validateByClientType (см. ниже) — там вес/объём
// структурно не собираются, до этой карты дело не доходит.
// 1 — нашёл товар, 2 — товар уже куплен, 3 — отдельные услуги.
const REFINING_FIELDS_BY_CLIENT_TYPE: Record<number, RefiningFieldsFn> = {
  1: (s) => (s.delivery_mode == null ? ['delivery_mode'] : []),
  2: refiningFieldsForShipping,
  3: () => [],
}

// client_type 3 (docs_only/консультация по отдельным услугам) не всегда доходит до физической
// перевозки — потолок точности ниже, даже если формально все поля собраны.
const ACCURACY_CEILING: Partial<Record<number, CalculationAccuracy>> = {
  3: 'medium',
}

const ACCURACY_RANK: Record<CalculationAccuracy, number> = { low: 0, medium: 1, high: 2 }

export const FIELD_LABELS: Record<string, string> = {
  weight_or_volume: 'вес или объём груза',
  category: 'категория товара',
  origin_city: 'город отправления',
  destination_city: 'город доставки',
  product_cost: 'стоимость товара',
  delivery_mode: 'способ доставки (карго/белая)',
  supplier: 'поставщик',
}

export interface ValidationResult {
  calculation_accuracy: CalculationAccuracy
  system_comments: string | null
  missingFieldLabels: string[]
}

function hasWeightOrVolume(shipment: Shipment): boolean {
  return shipment.weight_kg != null || shipment.volume_m3 != null
}

function minAccuracy(a: CalculationAccuracy, b: CalculationAccuracy): CalculationAccuracy {
  return ACCURACY_RANK[a] <= ACCURACY_RANK[b] ? a : b
}

function accuracyFromMissingCount(count: number): CalculationAccuracy {
  return count === 0 ? 'high' : count === 1 ? 'medium' : 'low'
}

function validateByClientType(shipment: Shipment): { accuracy: CalculationAccuracy; missingKeys: string[] } {
  const clientType = shipment.client_type ?? 3

  // docs_only — оформление/сертификация без физической перевозки, вес/объём не всегда применимы.
  if (shipment.delivery_mode === 'docs_only') return { accuracy: 'low', missingKeys: [] }

  // client_type 0 — "полный цикл поставки": товар/поставщик ещё не найден, поэтому вес/объём
  // структурно неоткуда взять (этот вопрос вообще не задаётся в этой ветке) — не "недостающие
  // данные", а ожидаемое состояние. Расчёт для неё не показывается вовсе (pricingEngine).
  if (clientType === 0) return { accuracy: 'low', missingKeys: [] }

  if (!hasWeightOrVolume(shipment)) {
    return { accuracy: 'low', missingKeys: ['weight_or_volume'] }
  }

  const refiningFn = REFINING_FIELDS_BY_CLIENT_TYPE[clientType] ?? REFINING_FIELDS_BY_CLIENT_TYPE[3]
  const missingKeys = refiningFn(shipment).filter((field) => shipment[field] == null)
  return { accuracy: accuracyFromMissingCount(missingKeys.length), missingKeys }
}

/**
 * Проверяет полноту данных Shipment и определяет точность расчёта.
 * Вызывается после каждого ответа — точность растёт по мере заполнения модели.
 */
export function validateShipment(shipment: Shipment): ValidationResult {
  const clientType = shipment.client_type ?? 3

  const { accuracy: rawAccuracy, missingKeys } = validateByClientType(shipment)

  const ceiling = ACCURACY_CEILING[clientType]
  const accuracy = ceiling ? minAccuracy(rawAccuracy, ceiling) : rawAccuracy

  const missingFieldLabels = missingKeys.map((key) => FIELD_LABELS[key] ?? key)
  const system_comments = missingFieldLabels.length
    ? `Не хватает данных для точного расчёта: ${missingFieldLabels.join(', ')}.`
    : null

  return { calculation_accuracy: accuracy, system_comments, missingFieldLabels }
}
