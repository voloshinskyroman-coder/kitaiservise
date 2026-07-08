export type DeliveryMode = 'cargo' | 'white' | 'docs_only'
export type CalculationAccuracy = 'low' | 'medium' | 'high'
export type LeadTemperature = 'hot' | 'warm' | 'cold'
export type ShipmentStatus = 'in_progress' | 'completed'
export type LogistStatus = 'new' | 'contacted' | 'closed'
export type Currency = 'CNY' | 'USD' | 'RUB'
export type CargoReadiness = 'ready' | 'week' | 'month' | 'unknown'
/** Насколько срочно нужна доставка (в днях в пути) — отдельно от готовности груза к отправке. */
export type DeliveryUrgency = '7-10' | '10-14' | '14-30' | '30-45'
/** Внутренний код сценария (не показывается клиенту) — определяет, по какой ветке квиза он идёт. */
export type ClientType = 0 | 1 | 2 | 3
export type PriorExperience = 'white' | 'cargo' | 'none'
export type DestinationType = 'city' | 'warehouse' | 'door' | 'not_needed'
export type PackageType = 'boxes' | 'pallets' | 'bags' | 'other'
export type ContractHolder = 'us' | 'client' | 'unknown'
export type Urgency = 'urgent' | 'month' | 'not_urgent'

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
  client_type: ClientType | null
  prior_experience: PriorExperience | null

  delivery_mode: DeliveryMode | null
  category: string | null
  product_description: string | null
  product_reference_type: string | null
  product_reference_value: string | null
  product_location: string | null
  // AI-анализ товара (tn.md) — заполняется автоматически при ответе на описание товара,
  // логист подтверждает/исправляет код вручную (hs_code_confirmed). hs_code_suggested всегда
  // сверен с официальным классификатором ФНС (hs_codes) — либо совпал, либо скорректирован.
  hs_code_suggested: string | null
  hs_code_suggested_description: string | null
  hs_code_confirmed: string | null
  ai_confidence: number | null
  ai_suggested_documents: string[]
  ai_suggested_non_tariff: string[]
  // Вложение (инвойс/упаковочный лист) — путь в приватном Storage-бакете shipment-documents,
  // не публичный URL. attachment_ai_summary заполняется AI-анализом фото в фоне.
  attachment_path: string | null
  attachment_mime_type: string | null
  attachment_ai_summary: string | null
  origin_city: string | null
  destination_city: string | null
  destination_type: DestinationType | null
  supplier: string | null
  supplier_status: string | null
  payment_status: string | null
  payment_method: string | null
  needs_supplier_search: boolean | null
  needs_supplier_check: 'yes' | 'no' | 'unknown' | null

  product_cost: number | null
  purchase_budget: number | null
  currency: Currency | null
  weight_kg: number | null
  volume_m3: number | null
  package_count: number | null
  package_type: PackageType | null
  box_dimensions: PartialBoxDimensions | null

  needs_money_transfer: boolean | null
  needs_logistics_calc: boolean | null
  cargo_readiness: CargoReadiness | null
  delivery_urgency: DeliveryUrgency | null
  certificates_note: string | null
  customs_contract_holder: ContractHolder | null
  logistics_method: string | null
  urgency: Urgency | null
  client_comment: string | null

  extra_services: string[]
  separate_services: string[]
  non_tariff_services: string[]
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
