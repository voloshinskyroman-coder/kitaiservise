import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Автодополнение по Google Product Taxonomy (ru-RU) — см. scripts/seed-product-categories.mjs, tn.md.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, path, leaf_name')
    .ilike('leaf_name', `%${q}%`)
    .order('leaf_name', { ascending: true })
    .limit(8)

  if (error) {
    return NextResponse.json({ suggestions: [] })
  }

  return NextResponse.json({ suggestions: data ?? [] })
}
