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

function chargeableWeightKg(shipment: Shipment): number | null {
  const volumetric = shipment.volume_m3 ? shipment.volume_m3 * VOLUMETRIC_DIVISOR_KG_PER_M3 : null
  const actual = shipment.weight_kg
  if (actual != null && volumetric != null) return Math.max(actual, volumetric)
  return actual ?? volumetric
}

function resolveDeliveryDays(shipment: Shipment) {
  return shipment.delivery_mode === 'white' ? DELIVERY_DAYS.white : DELIVERY_DAYS.cargo
}

function recalculateMoneyTransfer(shipment: Shipment): PricingResult {
  const spread = SPREAD_BY_ACCURACY[shipment.calculation_accuracy ?? 'low']
  const patch: PricingPatch = {
    estimated_route: null,
    estimated_delivery_days_min: null,
    estimated_delivery_days_max: null,
    estimated_price_min: null,
    estimated_price_max: null,
  }

  if (shipment.product_cost == null) return { patch, note: null }

  const centerFee = shipment.product_cost * MONEY_TRANSFER_FEE_RATE
  return {
    patch: {
      ...patch,
      estimated_price_min: Math.round(centerFee * (1 - spread)),
      estimated_price_max: Math.round(centerFee * (1 + spread)),
    },
    note: null,
  }
}

/**
 * Пересчитывает диапазон стоимости и срок доставки на основе текущего состояния Shipment.
 * Точность (calculation_accuracy) к этому моменту уже определена validationEngine —
 * pricingEngine только использует её, чтобы выбрать ширину разброса.
 */
export function recalculatePricing(shipment: Shipment): PricingResult {
  if (shipment.scenario === 'money_transfer') return recalculateMoneyTransfer(shipment)

  const days = resolveDeliveryDays(shipment)
  const route = `${shipment.origin_city ?? 'Китай'} → ${shipment.destination_city ?? 'Москва'}`
  const weight = chargeableWeightKg(shipment)

  if (weight == null) {
    return {
      patch: {
        estimated_route: route,
        estimated_delivery_days_min: days.min,
        estimated_delivery_days_max: days.max,
        estimated_price_min: UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB.min,
        estimated_price_max: UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB.max,
      },
      note: null,
    }
  }

  const categoryCoefficient = CATEGORY_COEFFICIENTS[shipment.category ?? 'other'] ?? 1
  const freightCenter = weight * BASE_RATE_RUB_PER_KG * categoryCoefficient
  const spread = SPREAD_BY_ACCURACY[shipment.calculation_accuracy ?? 'low']

  if (shipment.delivery_mode === 'white' && shipment.product_cost != null) {
    const white = calculateWhiteDelivery(shipment.product_cost)
    const note = white.needsManualReview
      ? 'Стоимость товара выше порога — потребуется ручная проверка таможенным брокером.'
      : null

    return {
      patch: {
        estimated_route: route,
        estimated_delivery_days_min: days.min,
        estimated_delivery_days_max: days.max,
        estimated_price_min: Math.round(freightCenter * (1 - spread)) + white.totalRub,
        estimated_price_max: Math.round(freightCenter * (1 + spread)) + white.totalRub,
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
      estimated_price_min: Math.round(centerPrice * (1 - spread)),
      estimated_price_max: Math.round(centerPrice * (1 + spread)),
    },
    note: null,
  }
}
