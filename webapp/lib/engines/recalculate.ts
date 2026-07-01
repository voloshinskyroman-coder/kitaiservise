import type { Shipment } from '@/lib/types/shipment'
import { validateShipment } from './validationEngine'
import { recalculatePricing } from './pricingEngine'
import { recalculateLeadScore } from './leadScoringEngine'

export interface RecalculationResult {
  shipment: Shipment
  missingFieldLabels: string[]
}

/**
 * Единая точка пересчёта производных полей Shipment после каждого ответа:
 * validation (точность) -> pricing (использует точность) -> lead scoring (независим от цены).
 */
export function recalculateShipment(shipment: Shipment): RecalculationResult {
  const validation = validateShipment(shipment)
  const withValidation: Shipment = {
    ...shipment,
    calculation_accuracy: validation.calculation_accuracy,
    system_comments: validation.system_comments,
  }

  const pricing = recalculatePricing(withValidation)
  const combinedComments = [validation.system_comments, pricing.note].filter(Boolean).join(' ') || null
  const withPricing: Shipment = { ...withValidation, ...pricing.patch, system_comments: combinedComments }

  const withScoring: Shipment = { ...withPricing, ...recalculateLeadScore(withPricing) }

  return { shipment: withScoring, missingFieldLabels: validation.missingFieldLabels }
}
