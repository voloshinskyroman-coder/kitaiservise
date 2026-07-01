import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadCrmCards } from '@/lib/queries/crm'
import { CrmBoard } from './CrmBoard'

export const dynamic = 'force-dynamic'

export default async function CrmPage() {
  const cards = await loadCrmCards(createServerSupabaseClient())

  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">CRM</h1>
        <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-200">← Админка</Link>
      </div>

      <CrmBoard initialCards={cards} />
    </div>
  )
}
