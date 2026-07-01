import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadOutreachData } from '@/lib/queries/outreach'
import { loadCrmCards } from '@/lib/queries/crm'
import { AdminTabs } from './AdminTabs'
import { LogoutButton } from './LogoutButton'
import type { Shipment } from '@/lib/types/shipment'
import type { FunnelRow } from './FunnelTab'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const supabase = createServerSupabaseClient()

  const [leadsRes, funnelRes, outreach, crm] = await Promise.all([
    supabase.from('shipments').select('*').order('created_at', { ascending: false }).limit(200).returns<Shipment[]>(),
    supabase
      .from('shipments')
      .select('id, status, purpose, delivery_mode, answers_log, telegram_user_id, telegram_username, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(500)
      .returns<FunnelRow[]>(),
    loadOutreachData(supabase),
    loadCrmCards(supabase),
  ])

  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Админ-панель KitaiService</h1>
        <LogoutButton />
      </div>

      <AdminTabs leads={leadsRes.data ?? []} funnel={funnelRes.data ?? []} outreach={outreach} crm={crm} />
    </div>
  )
}
