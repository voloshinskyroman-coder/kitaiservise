import type { Shipment } from './shipment'

/** То, что реально можно показать пользователю в Mini App — без внутреннего скоринга и комментариев. */
export type PublicShipment = Pick<
  Shipment,
  | 'status'
  | 'estimated_route'
  | 'estimated_delivery_days_min'
  | 'estimated_delivery_days_max'
  | 'estimated_price_min'
  | 'estimated_price_max'
  | 'calculation_accuracy'
>

export function toPublicShipment(shipment: Shipment): PublicShipment {
  return {
    status: shipment.status,
    estimated_route: shipment.estimated_route,
    estimated_delivery_days_min: shipment.estimated_delivery_days_min,
    estimated_delivery_days_max: shipment.estimated_delivery_days_max,
    estimated_price_min: shipment.estimated_price_min,
    estimated_price_max: shipment.estimated_price_max,
    calculation_accuracy: shipment.calculation_accuracy,
  }
}
