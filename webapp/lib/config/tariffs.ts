// Плейсхолдер-тарифы (из открытых источников, без привязки к реальным договорам с перевозчиками).
// Заменить на реальные ставки, когда они появятся — pricingEngine больше нигде их не хардкодит.

export const BASE_RATE_RUB_PER_KG = 900

export const CATEGORY_COEFFICIENTS: Record<string, number> = {
  clothing: 1.0,
  electronics: 1.4,
  furniture: 0.8,
  auto_parts: 1.1,
  equipment: 1.3,
  cosmetics: 1.2,
  other: 1.0,
}

// Плейсхолдер-курсы для конвертации стоимости товара в рубли (пошлина/НДС считаются в рублях).
// Заменить на реальный курс ЦБ + наценку, когда появится источник котировок.
export const FX_RATE_TO_RUB: Record<'CNY' | 'USD' | 'RUB', number> = {
  CNY: 13,
  USD: 95,
  RUB: 1,
}

// Объёмный вес: сколько "весит" 1 м³ в кг при расчёте тарифа (стандартная авиа-практика).
export const VOLUMETRIC_DIVISOR_KG_PER_M3 = 200

// Пока не знаем стоимость товара (до заполнения White Delivery Engine) — грубая прикидка живого расчёта.
export const WHITE_DELIVERY_PROVISIONAL_MULTIPLIER = 1.35

// White Delivery Engine: пошлина/НДС/оформление/брокер — плейсхолдеры под реальную таможенную практику РФ.
export const CUSTOMS_DUTY_RATE = 0.1
export const VAT_RATE = 0.2
export const CUSTOMS_CLEARANCE_FEE_RUB = 3500
export const BROKER_FEE_RUB = 2500
export const MANUAL_REVIEW_THRESHOLD_RUB = 200_000

// Сценарий "нужен перевод денег" — комиссия за перевод поставщику, без доставки.
export const MONEY_TRANSFER_FEE_RATE = 0.05

export const DELIVERY_DAYS = {
  cargo: { min: 14, max: 21 },
  white: { min: 20, max: 30 },
} as const

// Диапазон "на глаз", когда вес/объём ещё не собраны.
export const UNKNOWN_WEIGHT_FALLBACK_RANGE_RUB = { min: 3000, max: 15000 }

export const SPREAD_BY_ACCURACY: Record<'high' | 'medium' | 'low', number> = {
  high: 0.15,
  medium: 0.25,
  low: 0.35,
}
