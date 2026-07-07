import type { Shipment } from '@/lib/types/shipment'
import {
  BASE_RATE_RUB_PER_KG,
  CATEGORY_COEFFICIENTS,
  VOLUMETRIC_DIVISOR_KG_PER_M3,
  WHITE_DELIVERY_PROVISIONAL_MULTIPLIER,
  DELIVERY_DAYS,
  UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB,
  SPREAD_BY_ACCURACY,
  MONEY_TRANSFER_FEE_RATE,
  FX_RATE_TO_RUB,
} from '@/lib/config/tariffs'
import { calculateWhiteDelivery } from './whiteDeliveryEngine'

export type PricingPatch = Pick<
  Shipment,
  'estimated_route' | 'estimated_delivery_days_min' | 'estimated_delivery_days_max' | 'estimated_price_min' | 'estimated_price_max'
>

export interface PricingResult {
  patch: PricingPatch
  note: string | null
}

const EMPTY_PATCH: PricingPatch = {
  estimated_route: null,
  estimated_delivery_days_min: null,
  estimated_delivery_days_max: null,
  estimated_price_min: null,
  estimated_price_max: null,
}

function chargeableWeightKg(shipment: Shipment): number | null {
  const volumetric = shipment.volume_m3 ? shipment.volume_m3 * VOLUMETRIC_DIVISOR_KG_PER_M3 : null
  const actual = shipment.weight_kg
  if (actual != null && volumetric != null) return Math.max(actual, volumetric)
  return actual ?? volumetric
}

function resolveDeliveryDays(shipment: Shipment) {
  return shipment.delivery_mode === 'white' ? DELIVERY_DAYS.white : DELIVERY_DAYS.cargo
}

/** Стоимость товара может быть указана в валюте (юани/доллары) — переводим в рубли для расчётов. */
function productCostRub(shipment: Shipment): number | null {
  if (shipment.product_cost == null) return null
  return shipment.product_cost * FX_RATE_TO_RUB[shipment.currency ?? 'RUB']
}

/**
 * Пересчитывает диапазон стоимости и срок доставки на основе текущего состояния Shipment.
 * Точность (calculation_accuracy) к этому моменту уже определена validationEngine —
 * pricingEngine только использует её, чтобы выбрать ширину разброса.
 */
export function recalculatePricing(shipment: Shipment): PricingResult {
  // docs_only — только документы/оформление/сертификация, без физической перевозки:
  // формулы для этих услуг нет, честнее не показывать цифру, а передать заявку менеджеру.
  if (shipment.delivery_mode === 'docs_only') return { patch: EMPTY_PATCH, note: null }

  // client_type 0 — "полный цикл поставки": товар/поставщик ещё не найден (вес/объём в этой
  // ветке вообще не спрашиваются), поэтому придуманный диапазон был бы нечестным числом
  // без основания. Передаём на консультацию менеджеру.
  if (shipment.client_type === 0) return { patch: EMPTY_PATCH, note: null }

  const days = resolveDeliveryDays(shipment)
  const route = `${shipment.origin_city ?? 'Китай'} → ${shipment.destination_city ?? 'Москва'}`
  const weight = chargeableWeightKg(shipment)
  const spread = SPREAD_BY_ACCURACY[shipment.calculation_accuracy ?? 'low']
  const costRub = productCostRub(shipment)
  const transferFee = shipment.needs_money_transfer && costRub != null ? costRub * MONEY_TRANSFER_FEE_RATE : 0

  if (weight == null) {
    return {
      patch: {
        estimated_route: route,
        estimated_delivery_days_min: days.min,
        estimated_delivery_days_max: days.max,
        estimated_price_min: Math.round(UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB.min + transferFee),
        estimated_price_max: Math.round(UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB.max + transferFee),
      },
      note: null,
    }
  }

  const categoryCoefficient = CATEGORY_COEFFICIENTS[shipment.category ?? 'other'] ?? 1
  const freightCenter = weight * BASE_RATE_RUB_PER_KG * categoryCoefficient

  if (shipment.delivery_mode === 'white' && costRub != null) {
    const white = calculateWhiteDelivery(costRub)
    const note = white.needsManualReview
      ? 'Стоимость товара выше порога — потребуется ручная проверка таможенным брокером.'
      : null

    return {
      patch: {
        estimated_route: route,
        estimated_delivery_days_min: days.min,
        estimated_delivery_days_max: days.max,
        estimated_price_min: Math.round(freightCenter * (1 - spread) + white.totalRub + transferFee),
        estimated_price_max: Math.round(freightCenter * (1 + spread) + white.totalRub + transferFee),
      },
      note,
    }
  }

  // Белая доставка, но стоимость товара ещё не собрана (например, посреди квиза) — грубая прикидка множителем.
  const whiteMultiplier = shipment.delivery_mode === 'white' ? WHITE_DELIVERY_PROVISIONAL_MULTIPLIER : 1
  const centerPrice = freightCenter * whiteMultiplier

  return {
    patch: {
      estimated_route: route,
      estimated_delivery_days_min: days.min,
      estimated_delivery_days_max: days.max,
      estimated_price_min: Math.round(centerPrice * (1 - spread) + transferFee),
      estimated_price_max: Math.round(centerPrice * (1 + spread) + transferFee),
    },
    note: null,
  }
}
