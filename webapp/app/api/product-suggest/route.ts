import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Автодополнение по Google Product Taxonomy (ru-RU) — см. scripts/seed-product-categories.mjs, tn.md.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const supabase = createServerSupabaseClient()
  // Берём с запасом (алфавитный ORDER BY в самом запросе не важен — сортируем ниже по релевантности),
  // иначе при >8 совпадениях на один запрос нужные варианты (например "Электромассажёры" на "Э")
  // могли обрезаться просто потому, что алфавитно оказывались в конце.
  const { data, error } = await supabase.from('product_categories').select('id, path, leaf_name').ilike('leaf_name', `%${q}%`).limit(60)

  if (error || !data) {
    return NextResponse.json({ suggestions: [] })
  }

  const queryLower = q.toLowerCase()
  const ranked = data
    .sort((a, b) => {
      const aPrefix = a.leaf_name.toLowerCase().startsWith(queryLower) ? 0 : 1
      const bPrefix = b.leaf_name.toLowerCase().startsWith(queryLower) ? 0 : 1
      if (aPrefix !== bPrefix) return aPrefix - bPrefix
      return a.leaf_name.length - b.leaf_name.length
    })
    .slice(0, 15)

  return NextResponse.json({ suggestions: ranked })
}
