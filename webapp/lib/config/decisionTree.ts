import type { Shipment, DeliveryMode } from '@/lib/types/shipment'

export type QuestionType = 'choice' | 'multi-choice' | 'number' | 'text' | 'info'

export interface QuestionOption {
  value: string
  label: string
  /** Короткое пояснение под заголовком варианта (когда одной фразы недостаточно). */
  description?: string
}

export interface QuestionNode {
  id: string
  prompt: string
  type: QuestionType
  options?: QuestionOption[]
  /** Необязательный вопрос — клиент показывает кнопку "Пропустить". */
  optional?: boolean
  /** Для text — показывать подсказки по мере ввода (см. /api/product-suggest, Google Product Taxonomy). */
  autocomplete?: boolean
  /** Для text — на этом же экране доп. блок "прикрепить инвойс/упаковочный лист" (необязательно). */
  withAttachment?: boolean
  /** Для multi-choice — какие значения предзаполнить галочками (например, по результату AI-анализа товара). */
  preselect?: (shipment: Shipment) => string[]
  /** Патч в Shipment на основе сырого ответа пользователя (multi-choice приходит как JSON.stringify(string[])). */
  applyAnswer: (shipment: Shipment, rawAnswer: string) => Partial<Shipment>
  /** Следующий вопрос дерева сценариев, либо null — конец квиза. */
  next: (shipment: Shipment, rawAnswer: string) => string | null
}

export const START_QUESTION_ID = 'prior_experience'

// ───────────────────────── общие списки опций ─────────────────────────

export const CATEGORY_OPTIONS: QuestionOption[] = [
  { value: 'clothing', label: 'Одежда' },
  { value: 'electronics', label: 'Техника/электроника' },
  { value: 'furniture', label: 'Мебель' },
  { value: 'auto_parts', label: 'Автозапчасти' },
  { value: 'equipment', label: 'Оборудование' },
  { value: 'cosmetics', label: 'Косметика' },
  { value: 'other', label: 'Другое' },
]

// Единый вопрос про оплату поставщику — общий для CT0 и CT1, без варианта "не знаю".
const PAYMENT_METHOD_OPTIONS: QuestionOption[] = [
  {
    value: 'self_invoice',
    label: 'Самостоятельно поставщику',
    description:
      'Вы самостоятельно переводите деньги поставщику по инвойсу со своего банковского счёта. Подходит, если поставщик принимает платежи из России.',
  },
  {
    value: 'to_our_cn_company',
    label: 'Через нашу компанию в Китае',
    description: 'Вы переводите деньги на нашу китайскую компанию, а мы оплачиваем их вашему поставщику. Подходит, если поставщик не принимает платежи из России.',
  },
  {
    value: 'agent_agreement_rf',
    label: 'Через агентский договор в РФ',
    description: 'Заключаем агентский договор. Вы оплачиваете нам в рублях на российскую компанию, а мы самостоятельно переводим деньги поставщику в Китай.',
  },
  {
    value: 'to_our_rf_company',
    label: 'Через российскую компанию',
    description: 'Покупаете товар у нашей российской компании по договору поставки. Оплата производится в рублях с полным комплектом закрывающих документов.',
  },
]

// Способ оплаты однозначно определяет, на чей контракт оформляется таможня —
// отдельно этот вопрос не задаём (только там, где способ оплаты вообще известен, т.е. CT1).
const CONTRACT_HOLDER_BY_PAYMENT_METHOD: Record<string, 'client' | 'us'> = {
  self_invoice: 'client',
  to_our_cn_company: 'client',
  agent_agreement_rf: 'us',
  to_our_rf_company: 'us',
}

const DELIVERY_MODE_OPTIONS: QuestionOption[] = [
  { value: 'white', label: 'Официальная доставка с таможенным оформлением (белая доставка)' },
  { value: 'cargo', label: 'Упрощённая доставка (карго)' },
  { value: 'unknown', label: 'Не знаю, помогите выбрать' },
]

const DELIVERY_MODE_FORCED_OPTIONS: QuestionOption[] = [
  { value: 'white', label: 'Белая доставка' },
  { value: 'cargo', label: 'Карго' },
]

const MODE_EXPLAINER_PROMPT =
  'Карго — быстрее и дешевле, но без полного таможенного оформления. Белая доставка — с документами и таможенным оформлением, дольше и дороже, зато полностью законно и с чеками. Что выберете?'

const READINESS_OPTIONS: QuestionOption[] = [
  { value: 'ready', label: 'Уже готов' },
  { value: 'week', label: 'Через неделю' },
  { value: 'month', label: 'Через месяц' },
  { value: 'unknown', label: 'Пока неизвестно' },
]

const DESTINATION_HUB_OPTIONS: QuestionOption[] = [
  { value: 'vladivostok', label: 'Владивосток (Дальний Восток)' },
  { value: 'moscow', label: 'Москва (Центральный регион)' },
]

const DESTINATION_HUB_CITY: Record<string, string> = {
  vladivostok: 'Владивосток',
  moscow: 'Москва',
}

export const DOCUMENTS_WHITE_OPTIONS: QuestionOption[] = [
  { value: 'invoice', label: 'Инвойс', description: 'Счёт от поставщика с перечнем товаров и их стоимостью.' },
  { value: 'packing_list', label: 'Упаковочный лист', description: 'Документ с количеством мест, весом и размерами груза.' },
  { value: 'contract', label: 'Контракт', description: 'Договор между покупателем и поставщиком на поставку товара.' },
  { value: 'hs_code', label: 'Код ТН ВЭД', description: 'Код товара для таможенного оформления. Если не знаете — поможем определить.' },
  {
    value: 'certificates',
    label: 'Сертификаты / декларации соответствия',
    description: 'Документы, подтверждающие соответствие товара требованиям законодательства. Нужны не для всех товаров.',
  },
  { value: 'none', label: 'Пока документов нет', description: 'Это нормально. Мы подскажем, какие документы понадобятся именно для вашего груза.' },
]

export const DOCUMENTS_CARGO_OPTIONS: QuestionOption[] = [
  { value: 'invoice', label: 'Инвойс (Invoice)' },
  { value: 'product_photo', label: 'Фото товара' },
  { value: 'packing_list', label: 'Упаковочный лист (Packing List)' },
  { value: 'none', label: 'Ничего нет' },
  { value: 'unknown', label: 'Не знаю' },
]

const CONTRACT_HOLDER_OPTIONS: QuestionOption[] = [
  { value: 'us', label: 'На наш контракт' },
  { value: 'client', label: 'На контракт клиента' },
  { value: 'unknown', label: 'Не знаю' },
]

export const NON_TARIFF_OPTIONS: QuestionOption[] = [
  {
    value: 'ds',
    label: 'Сертификация ДС',
    description: 'Декларация соответствия. Требуется для многих категорий товаров при официальном ввозе.',
  },
  {
    value: 'sstc',
    label: 'Сертификация ССТС',
    description: 'Сертификат соответствия. Обязателен для отдельных товаров с повышенными требованиями безопасности.',
  },
  {
    value: 'ru',
    label: 'Регистрационное удостоверение (РУ)',
    description: 'Требуется для медицинских изделий и отдельных категорий оборудования.',
  },
  {
    value: 'sgr',
    label: 'Свидетельство о государственной регистрации (СГР)',
    description: 'Необходимо для отдельных категорий продукции, например детских товаров, косметики и бытовой химии.',
  },
  {
    value: 'eac',
    label: 'EAC-маркировка',
    description: 'Нанесение знака EAC на товар и упаковку в соответствии с требованиями ТР ТС.',
  },
  {
    value: 'chestny_znak',
    label: 'Маркировка «Честный знак»',
    description: 'Обязательная цифровая маркировка для отдельных категорий товаров, например одежды, обуви, шин, парфюмерии и других.',
  },
  {
    value: 'unknown',
    label: 'Нужна консультация',
    description: 'Поможем определить, какие документы и маркировка потребуются именно для вашего товара.',
  },
]

export const LOGISTICS_METHOD_OPTIONS: QuestionOption[] = [
  { value: 'consolidated', label: 'Сборный груз' },
  { value: 'auto_ussuriysk', label: 'Авто Уссурийск' },
  { value: 'auto_moscow', label: 'Авто Москва' },
  { value: 'sea_container_vladivostok', label: 'Морской контейнер, порт Владивосток' },
  { value: 'sea_rail_moscow', label: 'Море + ЖД Москва' },
  { value: 'direct_rail_moscow', label: 'Прямое ЖД Москва' },
  { value: 'air_moscow', label: 'Авиа Москва' },
  { value: 'tir_moscow', label: 'TIR фура до Москвы' },
  { value: 'tir_suifenhe_vladivostok', label: 'Фура Суйфэньхэ → Владивосток' },
  { value: 'unknown', label: 'Не знаю, пусть подберёт логист' },
]

export const EXTRA_SERVICES_OPTIONS: QuestionOption[] = [
  { value: 'inspection', label: 'Проверка товара' },
  { value: 'photo_video_report', label: 'Фото/видео отчёт' },
  { value: 'packaging', label: 'Упаковка/переупаковка' },
  { value: 'insurance', label: 'Страхование' },
  { value: 'storage', label: 'Хранение' },
]

const CT3_EXPORT_DOCS_OPTIONS: QuestionOption[] = [
  { value: 'export_declaration', label: 'Экспортная декларация' },
  { value: 'invoice', label: 'Счёт-фактура' },
  { value: 'packing_list', label: 'Упаковочный лист' },
  { value: 'supplier_docs', label: 'Документы поставщика' },
  { value: 'unknown', label: 'Не знаю' },
]

const CT3_CUSTOMS_DOCS_OPTIONS: QuestionOption[] = [
  { value: 'invoice', label: 'Инвойс' },
  { value: 'packing_list', label: 'Упаковочный лист' },
  { value: 'contract', label: 'Контракт' },
  { value: 'hs_code', label: 'Код ТН ВЭД' },
  { value: 'certificates', label: 'Сертификаты' },
  { value: 'unknown', label: 'Не знаю' },
]

// documents может прийти из разных наборов опций (белая/карго/экспорт/таможня — исторические
// заявки CT3, ветка убрана из активного дерева) —
// объединяем для единого поиска лейбла в карточке логиста/админке.
function mergeOptionsByValue(...lists: QuestionOption[][]): QuestionOption[] {
  const byValue = new Map<string, QuestionOption>()
  for (const list of lists) {
    for (const option of list) {
      if (!byValue.has(option.value)) byValue.set(option.value, option)
    }
  }
  return [...byValue.values()]
}

export const ALL_DOCUMENT_OPTIONS: QuestionOption[] = mergeOptionsByValue(
  DOCUMENTS_WHITE_OPTIONS,
  DOCUMENTS_CARGO_OPTIONS,
  CT3_EXPORT_DOCS_OPTIONS,
  CT3_CUSTOMS_DOCS_OPTIONS,
)

// ───────────────────────── утилиты ─────────────────────────

function parseMultiChoice(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

const URL_PATTERN = /^(https?:\/\/|www\.)\S+/i

// Одно универсальное поле "название или ссылка" (tn.md) вместо выбора категории + отдельного
// описания — категорию для расчёта теперь определяет AI-анализ товара (см. aiProductAnalysis.ts).
function applyProductInput(raw: string): Partial<Shipment> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  if (URL_PATTERN.test(trimmed)) {
    return { product_reference_value: trimmed, product_reference_type: 'link' }
  }
  return { product_description: trimmed }
}

// Вложение — необязательная часть того же экрана, что и товар (withAttachment). Клиент грузит
// файл заранее через /api/shipment/upload, а сюда шлёт JSON {product, attachment: {path, mimeType} | null}.
function applyProductAndAttachment(raw: string): Partial<Shipment> {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.product !== 'string') {
      throw new Error('not a combined answer')
    }
    const productPatch = applyProductInput(parsed.product)
    if (!parsed.attachment || typeof parsed.attachment.path !== 'string') return productPatch
    return {
      ...productPatch,
      attachment_path: parsed.attachment.path,
      attachment_mime_type: typeof parsed.attachment.mimeType === 'string' ? parsed.attachment.mimeType : null,
    }
  } catch {
    // на случай резюме старой сессии, где ответ ещё был обычной строкой без вложения
    return applyProductInput(raw)
  }
}

function toNumberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const PURPOSE_LABELS: Record<string, string> = {
  full_cycle: 'Полный цикл поставки',
  found_item: 'Нашёл товар',
  already_bought: 'Товар уже куплен',
  separate_services: 'Нужны отдельные услуги',
}

const CLIENT_TYPE_TO_PURPOSE: Record<string, string> = {
  '0': 'full_cycle',
  '1': 'found_item',
  '2': 'already_bought',
  '3': 'separate_services',
}

export const DECISION_TREE: Record<string, QuestionNode> = {
  // ───────────────────────── вход: опыт + выбор clientType ─────────────────────────

  prior_experience: {
    id: 'prior_experience',
    prompt: 'Вы уже возили товары из Китая?',
    type: 'choice',
    options: [
      { value: 'white', label: 'Официальной доставкой с таможенным оформлением (белая доставка)' },
      { value: 'cargo', label: 'Упрощённой доставкой (карго)' },
      { value: 'none', label: 'Нет, первый раз' },
    ],
    applyAnswer: (_shipment, raw) => ({ prior_experience: raw as Shipment['prior_experience'] }),
    next: () => 'main_need',
  },

  main_need: {
    id: 'main_need',
    prompt: 'Что вам сейчас нужно?',
    type: 'choice',
    options: [
      { value: '0', label: 'Полный цикл поставки — от поиска поставщика, доставки и таможенного оформления' },
      { value: '1', label: 'Нашёл товар — нужна помощь с оплатой и доставкой' },
      { value: '2', label: 'Товар уже куплен — нужна доставка и оформление' },
    ],
    applyAnswer: (_shipment, raw) => ({
      client_type: Number(raw) as Shipment['client_type'],
      purpose: CLIENT_TYPE_TO_PURPOSE[raw] ?? raw,
      scenario: CLIENT_TYPE_TO_PURPOSE[raw] ?? raw,
      // "Полный цикл поставки" по определению означает, что поиск поставщика нужен —
      // отдельно не спрашиваем.
      ...(raw === '0' ? { needs_supplier_search: true } : {}),
    }),
    next: (_shipment, raw) => {
      if (raw === '0') return 'ct0_product'
      if (raw === '1') return 'ct1_has'
      return 'ct2_product'
    },
  },

  // ───────────────────────── CLIENT TYPE 0: полный цикл поставки ─────────────────────────

  // Клиент ищет товар с нуля — поиск и проверка поставщика для этой ветки подразумеваются
  // всегда (needs_supplier_search выставлен в main_need), отдельно не спрашиваем.
  // Категорию/код ТН ВЭД/документы дальше определяет AI-анализ (tn.md), а не отдельный выбор.
  ct0_product: {
    id: 'ct0_product',
    prompt: 'Что хотите привезти?\nВставьте ссылку на товар, прикрепите инвойс от поставщика или напишите, какой товар вам нужен.',
    type: 'text',
    autocomplete: true,
    withAttachment: true,
    applyAnswer: (_shipment, raw) => applyProductAndAttachment(raw),
    next: () => 'ct0_budget',
  },
  ct0_budget: {
    id: 'ct0_budget',
    prompt: 'Какой бюджет на закупку товара (в рублях)?',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ purchase_budget: toNumberOrNull(raw) }),
    next: () => 'ct0_urgency',
  },
  ct0_urgency: {
    id: 'ct0_urgency',
    prompt: 'Когда нужен товар?',
    type: 'choice',
    options: [
      { value: 'urgent', label: 'Срочно' },
      { value: 'month', label: 'В течение месяца' },
      { value: 'not_urgent', label: 'Не срочно' },
    ],
    applyAnswer: (_shipment, raw) => ({ urgency: raw as Shipment['urgency'] }),
    next: () => 'ct0_payment_method',
  },
  ct0_payment_method: {
    id: 'ct0_payment_method',
    prompt: 'Как вам удобнее оплатить поставщику?',
    type: 'choice',
    options: PAYMENT_METHOD_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ payment_method: raw }),
    next: () => 'ct0_destination_city',
  },
  ct0_destination_city: {
    id: 'ct0_destination_city',
    prompt: 'Куда доставить? Укажите город.',
    type: 'text',
    applyAnswer: (_shipment, raw) => ({ destination_city: raw }),
    next: () => 'ct0_comment',
  },
  ct0_comment: {
    id: 'ct0_comment',
    prompt: 'Есть что добавить?',
    type: 'text',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ client_comment: raw || null }),
    next: () => null,
  },

  // ───────────────────────── CLIENT TYPE 1: нашёл товар ─────────────────────────

  ct1_has: {
    id: 'ct1_has',
    prompt: 'Что у вас есть?',
    type: 'choice',
    options: [
      { value: 'link', label: 'Ссылка на товар' },
      { value: 'invoice', label: 'Инвойс' },
      { value: 'factory_contact', label: 'Контакты фабрики' },
      { value: 'commercial_offer', label: 'Коммерческое предложение' },
    ],
    applyAnswer: (_shipment, raw) => ({ product_reference_type: raw }),
    next: () => 'ct1_product',
  },
  ct1_product: {
    id: 'ct1_product',
    prompt: 'Что хотите привезти?\nВставьте ссылку на товар, прикрепите инвойс от поставщика или напишите, какой товар вам нужен.',
    type: 'text',
    autocomplete: true,
    withAttachment: true,
    applyAnswer: (_shipment, raw) => applyProductAndAttachment(raw),
    next: () => 'ct1_payment_method',
  },
  ct1_payment_method: {
    id: 'ct1_payment_method',
    prompt: 'Как вам удобнее оплатить поставщику?',
    type: 'choice',
    options: PAYMENT_METHOD_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ payment_method: raw }),
    next: () => 'ct1_origin',
  },
  ct1_origin: {
    id: 'ct1_origin',
    prompt: 'В каком городе или провинции находится ваш товар?',
    type: 'text',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ origin_city: raw || null }),
    next: () => 'ct1_destination',
  },
  ct1_destination: {
    id: 'ct1_destination',
    prompt: 'Куда доставить ваш груз?\nДоставка по России рассчитывается отдельно.',
    type: 'choice',
    options: DESTINATION_HUB_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ destination_city: DESTINATION_HUB_CITY[raw] ?? raw }),
    next: () => 'ct1_delivery_mode',
  },
  ct1_delivery_mode: {
    id: 'ct1_delivery_mode',
    prompt: 'Какой вариант доставки нужен?',
    type: 'choice',
    options: DELIVERY_MODE_OPTIONS,
    applyAnswer: (_shipment, raw) => (raw === 'unknown' ? {} : { delivery_mode: raw as DeliveryMode }),
    next: (_shipment, raw) => (raw === 'unknown' ? 'ct1_mode_explainer' : 'ct1_cost'),
  },
  ct1_mode_explainer: {
    id: 'ct1_mode_explainer',
    prompt: MODE_EXPLAINER_PROMPT,
    type: 'info',
    applyAnswer: () => ({}),
    next: () => 'ct1_delivery_mode_forced',
  },
  ct1_delivery_mode_forced: {
    id: 'ct1_delivery_mode_forced',
    prompt: 'Какая доставка нужна?',
    type: 'choice',
    options: DELIVERY_MODE_FORCED_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ delivery_mode: raw as DeliveryMode }),
    next: () => 'ct1_cost',
  },
  ct1_cost: {
    id: 'ct1_cost',
    prompt: 'Стоимость товара в юанях? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ product_cost: toNumberOrNull(raw), currency: 'CNY' }),
    next: () => 'ct1_weight',
  },
  ct1_weight: {
    id: 'ct1_weight',
    prompt: 'Вес (кг)? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ weight_kg: toNumberOrNull(raw) }),
    next: () => 'ct1_volume',
  },
  ct1_volume: {
    id: 'ct1_volume',
    prompt: 'Объём (м³)? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ volume_m3: toNumberOrNull(raw) }),
    next: () => 'ct1_package_count',
  },
  ct1_package_count: {
    id: 'ct1_package_count',
    prompt: 'Количество мест? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ package_count: toNumberOrNull(raw) }),
    next: () => 'ct1_readiness',
  },
  ct1_readiness: {
    id: 'ct1_readiness',
    prompt: 'Груз готов?',
    type: 'choice',
    options: READINESS_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ cargo_readiness: raw as Shipment['cargo_readiness'] }),
    next: (shipment) => (shipment.delivery_mode === 'white' ? 'ct1_documents_white' : 'ct1_documents_cargo'),
  },
  ct1_documents_white: {
    id: 'ct1_documents_white',
    prompt: 'Какие документы у вас уже есть?',
    type: 'multi-choice',
    optional: true,
    options: DOCUMENTS_WHITE_OPTIONS,
    // Способ оплаты (спрошен раньше) однозначно определяет, на чей контракт оформляется
    // таможня — отдельным вопросом не переспрашиваем.
    applyAnswer: (shipment, raw) => ({
      documents: parseMultiChoice(raw),
      customs_contract_holder: CONTRACT_HOLDER_BY_PAYMENT_METHOD[shipment.payment_method ?? ''] ?? null,
    }),
    next: () => 'ct1_non_tariff',
  },
  ct1_documents_cargo: {
    id: 'ct1_documents_cargo',
    prompt: 'Какие документы у вас уже есть?',
    type: 'multi-choice',
    optional: true,
    options: DOCUMENTS_CARGO_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ documents: parseMultiChoice(raw) }),
    next: () => 'ct1_non_tariff',
  },
  ct1_non_tariff: {
    id: 'ct1_non_tariff',
    prompt: 'Какие дополнительные документы или маркировка могут понадобиться?',
    type: 'multi-choice',
    optional: true,
    options: NON_TARIFF_OPTIONS,
    // AI уже прикинул, какая сертификация/маркировка обычно нужна для этого товара (tn.md) —
    // предзаполняем галочки, клиент может изменить.
    preselect: (shipment) => shipment.ai_suggested_non_tariff,
    applyAnswer: (_shipment, raw) => ({ non_tariff_services: parseMultiChoice(raw) }),
    next: () => 'ct1_extra_services',
  },
  ct1_extra_services: {
    id: 'ct1_extra_services',
    prompt: 'Нужны дополнительные услуги?',
    type: 'multi-choice',
    optional: true,
    options: EXTRA_SERVICES_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ extra_services: parseMultiChoice(raw) }),
    next: () => null,
  },

  // ───────────────────────── CLIENT TYPE 2: товар уже куплен ─────────────────────────

  ct2_product: {
    id: 'ct2_product',
    prompt: 'Что перевозим?\nВставьте ссылку на товар, прикрепите инвойс от поставщика или напишите, какой товар везёте.',
    type: 'text',
    autocomplete: true,
    withAttachment: true,
    applyAnswer: (_shipment, raw) => applyProductAndAttachment(raw),
    next: () => 'ct2_origin',
  },
  ct2_origin: {
    id: 'ct2_origin',
    prompt: 'В каком городе или провинции находится ваш товар?',
    type: 'text',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ origin_city: raw || null }),
    next: () => 'ct2_destination',
  },
  ct2_destination: {
    id: 'ct2_destination',
    prompt: 'Куда доставить ваш груз?\nДоставка по России рассчитывается отдельно.',
    type: 'choice',
    options: DESTINATION_HUB_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ destination_city: DESTINATION_HUB_CITY[raw] ?? raw }),
    next: () => 'ct2_delivery_mode',
  },
  ct2_delivery_mode: {
    id: 'ct2_delivery_mode',
    prompt: 'Какой вариант доставки нужен?',
    type: 'choice',
    options: DELIVERY_MODE_OPTIONS,
    applyAnswer: (_shipment, raw) => (raw === 'unknown' ? {} : { delivery_mode: raw as DeliveryMode }),
    next: (_shipment, raw) => (raw === 'unknown' ? 'ct2_mode_explainer' : 'ct2_cost'),
  },
  ct2_mode_explainer: {
    id: 'ct2_mode_explainer',
    prompt: MODE_EXPLAINER_PROMPT,
    type: 'info',
    applyAnswer: () => ({}),
    next: () => 'ct2_delivery_mode_forced',
  },
  ct2_delivery_mode_forced: {
    id: 'ct2_delivery_mode_forced',
    prompt: 'Какая доставка нужна?',
    type: 'choice',
    options: DELIVERY_MODE_FORCED_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ delivery_mode: raw as DeliveryMode }),
    next: () => 'ct2_cost',
  },
  ct2_cost: {
    id: 'ct2_cost',
    prompt: 'Стоимость товара в юанях? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ product_cost: toNumberOrNull(raw), currency: 'CNY' }),
    next: () => 'ct2_weight',
  },
  ct2_weight: {
    id: 'ct2_weight',
    prompt: 'Вес (кг)? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ weight_kg: toNumberOrNull(raw) }),
    next: () => 'ct2_volume',
  },
  ct2_volume: {
    id: 'ct2_volume',
    prompt: 'Объём (м³)? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ volume_m3: toNumberOrNull(raw) }),
    next: () => 'ct2_package_count',
  },
  ct2_package_count: {
    id: 'ct2_package_count',
    prompt: 'Количество мест? Можно пропустить.',
    type: 'number',
    optional: true,
    applyAnswer: (_shipment, raw) => ({ package_count: toNumberOrNull(raw) }),
    next: () => 'ct2_readiness',
  },
  ct2_readiness: {
    id: 'ct2_readiness',
    prompt: 'Груз готов?',
    type: 'choice',
    options: READINESS_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ cargo_readiness: raw as Shipment['cargo_readiness'] }),
    next: (shipment) => (shipment.delivery_mode === 'white' ? 'ct2_documents_white' : 'ct2_documents_cargo'),
  },
  ct2_documents_white: {
    id: 'ct2_documents_white',
    prompt: 'Какие документы у вас уже есть?',
    type: 'multi-choice',
    optional: true,
    options: DOCUMENTS_WHITE_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ documents: parseMultiChoice(raw) }),
    next: () => 'ct2_contract_holder',
  },
  ct2_documents_cargo: {
    id: 'ct2_documents_cargo',
    prompt: 'Какие документы у вас уже есть?',
    type: 'multi-choice',
    optional: true,
    options: DOCUMENTS_CARGO_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ documents: parseMultiChoice(raw) }),
    next: () => 'ct2_non_tariff',
  },
  ct2_contract_holder: {
    id: 'ct2_contract_holder',
    prompt: 'На чей контракт оформлять таможню?',
    type: 'choice',
    options: CONTRACT_HOLDER_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ customs_contract_holder: raw as Shipment['customs_contract_holder'] }),
    next: () => 'ct2_non_tariff',
  },
  ct2_non_tariff: {
    id: 'ct2_non_tariff',
    prompt: 'Какие дополнительные документы или маркировка могут понадобиться?',
    type: 'multi-choice',
    optional: true,
    options: NON_TARIFF_OPTIONS,
    preselect: (shipment) => shipment.ai_suggested_non_tariff,
    applyAnswer: (_shipment, raw) => ({ non_tariff_services: parseMultiChoice(raw) }),
    next: () => 'ct2_logistics_method',
  },
  ct2_logistics_method: {
    id: 'ct2_logistics_method',
    prompt: 'Какой способ логистики интересен?',
    type: 'choice',
    options: LOGISTICS_METHOD_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ logistics_method: raw }),
    next: () => 'ct2_extra_services',
  },
  ct2_extra_services: {
    id: 'ct2_extra_services',
    prompt: 'Нужны дополнительные услуги?',
    type: 'multi-choice',
    optional: true,
    options: EXTRA_SERVICES_OPTIONS,
    applyAnswer: (_shipment, raw) => ({ extra_services: parseMultiChoice(raw) }),
    next: () => null,
  },
}

/** Человекочитаемая формулировка того, с чем клиент пришёл — для карточки логиста. */
export function getPurposeLabel(purpose: string | null): string {
  if (!purpose) return 'не указано'
  return PURPOSE_LABELS[purpose] ?? purpose
}

/** Переводит коды чекбоксов (documents/extra_services/...) в читаемые лейблы для карточки логиста/админки. */
export function labelsForValues(options: QuestionOption[], values: string[]): string[] {
  return values.map((value) => options.find((o) => o.value === value)?.label ?? value)
}
