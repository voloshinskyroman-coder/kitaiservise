import {
  CUSTOMS_DUTY_RATE,
  VAT_RATE,
  CUSTOMS_CLEARANCE_FEE_RUB,
  BROKER_FEE_RUB,
  MANUAL_REVIEW_THRESHOLD_RUB,
} from '@/lib/config/tariffs'

export interface WhiteDeliveryBreakdown {
  customsDutyRub: number
  vatRub: number
  clearanceFeeRub: number
  brokerFeeRub: number
  totalRub: number
  needsManualReview: boolean
}

/**
 * Работает только когда выбрана белая доставка и известна стоимость товара.
 * Если карго — этот модуль не вызывается вообще.
 */
export function calculateWhiteDelivery(productCostRub: number): WhiteDeliveryBreakdown {
  const customsDutyRub = Math.round(productCostRub * CUSTOMS_DUTY_RATE)
  const vatRub = Math.round((productCostRub + customsDutyRub) * VAT_RATE)
  const totalRub = customsDutyRub + vatRub + CUSTOMS_CLEARANCE_FEE_RUB + BROKER_FEE_RUB

  return {
    customsDutyRub,
    vatRub,
    clearanceFeeRub: CUSTOMS_CLEARANCE_FEE_RUB,
    brokerFeeRub: BROKER_FEE_RUB,
    totalRub,
    needsManualReview: productCostRub > MANUAL_REVIEW_THRESHOLD_RUB,
  }
}
