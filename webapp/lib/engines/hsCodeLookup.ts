import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export interface HsCodeEntry {
  code: string
  description: string
}

/** Точный поиск кода в официальном классификаторе ТН ВЭД ЕАЭС (см. scripts/seed-hs-codes.mjs). */
export async function lookupHsCode(code: string | null): Promise<HsCodeEntry | null> {
  if (!code || !/^\d{10}$/.test(code)) return null
  const supabase = createServerSupabaseClient()
  const { data } = await supabase.from('hs_codes').select('code, description').eq('code', code).maybeSingle<HsCodeEntry>()
  return data ?? null
}

/**
 * Реальные коды внутри той же товарной позиции (первые 4 цифры кода) — AI часто угадывает
 * верную позицию, но не точный лист (10 цифр), особенно дополняя нулями несуществующий код.
 * Даём модели реальные варианты вместо слепой повторной попытки.
 */
export async function findCodesByHeading(code: string | null, limit = 15): Promise<HsCodeEntry[]> {
  if (!code || code.length < 4) return []
  const heading = code.slice(0, 4)
  if (!/^\d{4}$/.test(heading)) return []
  const supabase = createServerSupabaseClient()
  const { data } = await supabase.from('hs_codes').select('code, description').like('code', `${heading}%`).limit(limit)
  return data ?? []
}
