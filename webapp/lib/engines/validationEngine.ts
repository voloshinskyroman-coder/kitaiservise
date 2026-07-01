import type { Shipment, CalculationAccuracy } from '@/lib/types/shipment'

// Без веса/объёма расчёт превращается в угадывание по категории — это критично для точности.
// Остальные поля лишь уточняют оценку. Для части сценариев набор уточняющих полей зависит
// от уже данных ответов (например, product_cost становится нужен только если выбрана белая доставка).
type RefiningFieldsFn = (shipment: Shipment) => (keyof Shipment)[]

const REFINING_FIELDS_BY_SCENARIO: Record<string, RefiningFieldsFn> = {
  already_bought: (s) => {
    const fields: (keyof Shipment)[] = ['category', 'origin_city']
    if (s.delivery_mode == null) fields.push('delivery_mode')
    if (s.delivery_mode === 'white') fields.push('product_cost')
    return fields
  },
  cargo_to_white: () => ['category', 'origin_city', 'product_cost'],
  need_purchase: (s) => {
    const fields: (keyof Shipment)[] = ['category', 'product_cost']
    if (s.delivery_mode == null) fields.push('delivery_mode')
    return fields
  },
  searching: () => ['category'],
  just_curious: () => ['category'],
}

// just_curious/searching — намеренно короткие сценарии без города/способа доставки,
// поэтому даже при полных данных они дают не более чем приблизительный расчёт.
const ACCURACY_CEILING: Partial<Record<string, CalculationAccuracy>> = {
  just_curious: 'medium',
  searching: 'medium',
}

const ACCURACY_RANK: Record<CalculationAccuracy, number> = { low: 0, medium: 1, high: 2 }

export const FIELD_LABELS: Record<string, string> = {
  weight_or_volume: 'вес или объём груза',
  category: 'категория товара',
  origin_city: 'город отправления',
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

/**
 * money_transfer — отдельный тип запроса без доставки: нужны только поставщик и сумма перевода.
 */
function validateMoneyTransfer(shipment: Shipment): { accuracy: CalculationAccuracy; missingKeys: string[] } {
  const missingKeys: string[] = []
  if (shipment.supplier == null) missingKeys.push('supplier')
  if (shipment.product_cost == null) missingKeys.push('product_cost')
  return { accuracy: accuracyFromMissingCount(missingKeys.length), missingKeys }
}

function validateShippingScenario(shipment: Shipment): { accuracy: CalculationAccuracy; missingKeys: string[] } {
  const scenario = shipment.scenario ?? 'just_curious'

  if (!hasWeightOrVolume(shipment)) {
    return { accuracy: 'low', missingKeys: ['weight_or_volume'] }
  }

  const refiningFn = REFINING_FIELDS_BY_SCENARIO[scenario] ?? REFINING_FIELDS_BY_SCENARIO.just_curious
  const missingKeys = refiningFn(shipment).filter((field) => shipment[field] == null)
  return { accuracy: accuracyFromMissingCount(missingKeys.length), missingKeys }
}

/**
 * Проверяет полноту данных Shipment и определяет точность расчёта.
 * Вызывается после каждого ответа — точность растёт по мере заполнения модели.
 */
export function validateShipment(shipment: Shipment): ValidationResult {
  const scenario = shipment.scenario ?? 'just_curious'

  const { accuracy: rawAccuracy, missingKeys } =
    scenario === 'money_transfer' ? validateMoneyTransfer(shipment) : validateShippingScenario(shipment)

  const ceiling = ACCURACY_CEILING[scenario]
  const accuracy = ceiling ? minAccuracy(rawAccuracy, ceiling) : rawAccuracy

  const missingFieldLabels = missingKeys.map((key) => FIELD_LABELS[key] ?? key)
  const system_comments = missingFieldLabels.length
    ? `Не хватает данных для точного расчёта: ${missingFieldLabels.join(', ')}.`
    : null

  return { calculation_accuracy: accuracy, system_comments, missingFieldLabels }
}
