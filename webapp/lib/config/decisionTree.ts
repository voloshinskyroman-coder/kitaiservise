import type { Shipment, DeliveryMode } from '@/lib/types/shipment'

export type QuestionType = 'choice' | 'number' | 'text'

export interface QuestionOption {
  value: string
  label: string
}

export interface QuestionNode {
  id: string
  prompt: string
  type: QuestionType
  options?: QuestionOption[]
  /** Патч в Shipment на основе сырого ответа пользователя. */
  applyAnswer: (shipment: Shipment, rawAnswer: string) => Partial<Shipment>
  /** Следующий вопрос дерева сценариев, либо null — конец квиза. */
  next: (shipment: Shipment, rawAnswer: string) => string | null
}

export const START_QUESTION_ID = 'purpose'

function mergeBoxDimension(shipment: Shipment, key: 'length_cm' | 'width_cm' | 'height_cm', value: number) {
  return { ...(shipment.box_dimensions ?? {}), [key]: value }
}

// purpose="белая доставка"/"карго" — тот же поток данных, что already_bought, только способ
// доставки известен сразу и вопрос delivery_mode дальше не задаётся.
const PURPOSE_TO_SCENARIO: Record<string, { scenario: string; deliveryMode: DeliveryMode | null }> = {
  already_bought: { scenario: 'already_bought', deliveryMode: null },
  need_purchase: { scenario: 'need_purchase', deliveryMode: null },
  searching: { scenario: 'searching', deliveryMode: null },
  money_transfer: { scenario: 'money_transfer', deliveryMode: null },
  white_experienced: { scenario: 'already_bought', deliveryMode: 'white' },
  cargo_experienced: { scenario: 'already_bought', deliveryMode: 'cargo' },
  cargo_to_white: { scenario: 'cargo_to_white', deliveryMode: 'white' },
  just_curious: { scenario: 'just_curious', deliveryMode: null },
}

/** Стоимость товара нужна и для need_purchase (свой вопрос), и как "дозаполнение" для белой доставки. */
function needsCostGapFill(shipment: Shipment): boolean {
  return shipment.delivery_mode === 'white' && shipment.product_cost == null
}

export const DECISION_TREE: Record<string, QuestionNode> = {
  purpose: {
    id: 'purpose',
    prompt: 'Что вам нужно?',
    type: 'choice',
    options: [
      { value: 'already_bought', label: 'Я уже купил товар, нужна доставка' },
      { value: 'need_purchase', label: 'Нужно найти и купить товар (нужен выкуп)' },
      { value: 'searching', label: 'Ищу товар, ещё не решил(а)' },
      { value: 'money_transfer', label: 'Нужно перевести деньги поставщику' },
      { value: 'white_experienced', label: 'Нужна белая доставка (с таможенным оформлением)' },
      { value: 'cargo_experienced', label: 'Нужна доставка карго' },
      { value: 'cargo_to_white', label: 'Раньше возил(а) карго, хочу перейти на белую доставку' },
      { value: 'just_curious', label: 'Просто интересует стоимость' },
    ],
    applyAnswer: (_shipment, raw) => {
      const resolved = PURPOSE_TO_SCENARIO[raw] ?? { scenario: raw, deliveryMode: null }
      return { purpose: raw, scenario: resolved.scenario, delivery_mode: resolved.deliveryMode }
    },
    next: (_shipment, raw) => {
      if (raw === 'need_purchase') return 'product_description'
      if (raw === 'money_transfer') return 'supplier'
      return 'category'
    },
  },

  product_description: {
    id: 'product_description',
    prompt: 'Опишите товар (ссылка на товар или несколько слов)',
    type: 'text',
    applyAnswer: (_shipment, raw) => ({ product_description: raw }),
    next: () => 'category',
  },

  supplier: {
    id: 'supplier',
    prompt: 'Кто поставщик? (ссылка на магазин или название)',
    type: 'text',
    applyAnswer: (_shipment, raw) => ({ supplier: raw }),
    next: () => 'product_cost',
  },

  category: {
    id: 'category',
    prompt: 'Категория товара?',
    type: 'choice',
    options: [
      { value: 'clothing', label: 'Одежда' },
      { value: 'electronics', label: 'Техника/электроника' },
      { value: 'furniture', label: 'Мебель' },
      { value: 'cosmetics', label: 'Косметика' },
      { value: 'other', label: 'Другое' },
    ],
    applyAnswer: (_shipment, raw) => ({ category: raw }),
    next: (shipment) => {
      if (shipment.scenario === 'already_bought' || shipment.scenario === 'cargo_to_white') return 'origin_city'
      if (shipment.scenario === 'need_purchase') return 'product_cost'
      return 'weight_bucket' // searching, just_curious
    },
  },

  origin_city: {
    id: 'origin_city',
    prompt: 'Откуда везём?',
    type: 'choice',
    options: [
      { value: 'guangzhou', label: 'Гуанчжоу' },
      { value: 'yiwu', label: 'Иу' },
      { value: 'shenzhen', label: 'Шэньчжэнь' },
      { value: 'other', label: 'Другой город / не знаю' },
    ],
    applyAnswer: (_shipment, raw) => ({ origin_city: raw }),
    next: () => 'knows_weight',
  },

  product_cost: {
    id: 'product_cost',
    prompt: 'Примерная стоимость товара (в рублях)?',
    type: 'number',
    applyAnswer: (_shipment, raw) => ({ product_cost: Number(raw) || null }),
    // need_purchase спрашивает стоимость до веса; money_transfer и "дозаполнение" для белой
    // доставки — уже после веса (или без него вовсе) и сразу завершают квиз.
    next: (shipment) => (shipment.scenario === 'need_purchase' ? 'knows_weight' : null),
  },

  knows_weight: {
    id: 'knows_weight',
    prompt: 'Вы знаете точный вес груза?',
    type: 'choice',
    options: [
      { value: 'yes', label: 'Да' },
      { value: 'no', label: 'Нет, но знаю размеры коробки' },
    ],
    applyAnswer: () => ({}),
    next: (_shipment, raw) => (raw === 'yes' ? 'weight_kg' : 'box_length'),
  },

  weight_kg: {
    id: 'weight_kg',
    prompt: 'Вес груза (кг)?',
    type: 'number',
    applyAnswer: (_shipment, raw) => ({ weight_kg: Number(raw) || null }),
    next: (shipment) => {
      if (shipment.delivery_mode == null) return 'delivery_mode'
      if (needsCostGapFill(shipment)) return 'product_cost'
      return null
    },
  },

  box_length: {
    id: 'box_length',
    prompt: 'Длина коробки (см)?',
    type: 'number',
    applyAnswer: (shipment, raw) => ({ box_dimensions: mergeBoxDimension(shipment, 'length_cm', Number(raw) || 0) }),
    next: () => 'box_width',
  },

  box_width: {
    id: 'box_width',
    prompt: 'Ширина коробки (см)?',
    type: 'number',
    applyAnswer: (shipment, raw) => ({ box_dimensions: mergeBoxDimension(shipment, 'width_cm', Number(raw) || 0) }),
    next: () => 'box_height',
  },

  box_height: {
    id: 'box_height',
    prompt: 'Высота коробки (см)?',
    type: 'number',
    applyAnswer: (shipment, raw) => {
      const dims = mergeBoxDimension(shipment, 'height_cm', Number(raw) || 0)
      const volume_m3 =
        dims.length_cm && dims.width_cm && dims.height_cm
          ? (dims.length_cm * dims.width_cm * dims.height_cm) / 1_000_000
          : null
      return { box_dimensions: dims, volume_m3 }
    },
    next: (shipment) => {
      if (shipment.delivery_mode == null) return 'delivery_mode'
      if (needsCostGapFill(shipment)) return 'product_cost'
      return null
    },
  },

  delivery_mode: {
    id: 'delivery_mode',
    prompt: 'Какая доставка нужна?',
    type: 'choice',
    options: [
      { value: 'cargo', label: 'Карго (быстрее и дешевле, без полного оформления документов)' },
      { value: 'white', label: 'Белая доставка (с таможенным оформлением и документами)' },
    ],
    applyAnswer: (_shipment, raw) => ({ delivery_mode: raw === 'white' ? 'white' : 'cargo' }),
    next: (shipment) => (needsCostGapFill(shipment) ? 'product_cost' : null),
  },

  weight_bucket: {
    id: 'weight_bucket',
    prompt: 'Примерный вес груза?',
    type: 'choice',
    options: [
      { value: 'up_to_5', label: 'До 5 кг' },
      { value: '5_to_20', label: '5–20 кг' },
      { value: '20_to_100', label: '20–100 кг' },
      { value: 'unknown', label: 'Не знаю' },
    ],
    applyAnswer: (_shipment, raw) => {
      const midpoints: Record<string, number | null> = {
        up_to_5: 2.5,
        '5_to_20': 12.5,
        '20_to_100': 60,
        unknown: null,
      }
      return { weight_kg: midpoints[raw] ?? null }
    },
    next: () => null,
  },
}

/** Человекочитаемая формулировка того, с чем клиент пришёл — для карточки логиста. */
export function getPurposeLabel(purpose: string | null): string {
  if (!purpose) return 'не указано'
  const option = DECISION_TREE.purpose.options?.find((o) => o.value === purpose)
  return option?.label ?? purpose
}
