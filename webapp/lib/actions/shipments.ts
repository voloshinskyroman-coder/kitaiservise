'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { LogistStatus } from '@/lib/types/shipment'

export async function setLogistStatus(id: string, logist_status: LogistStatus) {
  const supabase = createServerSupabaseClient()
  await supabase.from('shipments').update({ logist_status }).eq('id', id)
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin/leads')
  revalidatePath('/admin/crm')
}
