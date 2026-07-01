export type DeliveryMode = 'cargo' | 'white'
export type CalculationAccuracy = 'low' | 'medium' | 'high'
export type LeadTemperature = 'hot' | 'warm' | 'cold'
export type ShipmentStatus = 'in_progress' | 'completed'
export type LogistStatus = 'new' | 'contacted' | 'closed'

export interface BoxDimensions {
  length_cm: number
  width_cm: number
  height_cm: number
}

// Собирается по одному измерению за вопрос, поэтому до завершения — частичный.
export type PartialBoxDimensions = Partial<BoxDimensions>

export interface AnswerLogEntry {
  question_id: string
  answer: unknown
  answered_at: string
}

export interface Shipment {
  id: string

  telegram_user_id: number | null
  telegram_username: string | null

  status: ShipmentStatus
  logist_status: LogistStatus

  purpose: string | null
  scenario: string | null

  delivery_mode: DeliveryMode | null
  category: string | null
  product_description: string | null
  origin_city: string | null
  destination_city: string | null
  supplier: string | null
  supplier_status: string | null
  payment_status: string | null

  product_cost: number | null
  weight_kg: number | null
  volume_m3: number | null
  package_count: number | null
  box_dimensions: PartialBoxDimensions | null

  extra_services: string[]
  documents: string[]

  estimated_route: string | null
  estimated_delivery_days_min: number | null
  estimated_delivery_days_max: number | null
  estimated_price_min: number | null
  estimated_price_max: number | null
  calculation_accuracy: CalculationAccuracy | null

  lead_score: number
  lead_temperature: LeadTemperature | null

  system_comments: string | null
  answers_log: AnswerLogEntry[]

  created_at: string
  updated_at: string
}

export type NewShipment = Pick<Shipment, 'telegram_user_id' | 'telegram_username'>
