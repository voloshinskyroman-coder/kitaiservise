'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { LogistStatus } from '@/lib/types/shipment'

export async function setLogistStatus(id: string, logist_status: LogistStatus) {
  const supabase = createServerSupabaseClient()
  await supabase.from('shipments').update({ logist_status }).eq('id', id)
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin')
}

/** Логист вручную подтверждает код ТН ВЭД — начинает копить внутреннюю базу знаний (tn.md). */
export async function setHsCodeConfirmed(id: string, formData: FormData) {
  const hs_code_confirmed = String(formData.get('hs_code_confirmed') ?? '').trim() || null
  const supabase = createServerSupabaseClient()
  await supabase.from('shipments').update({ hs_code_confirmed }).eq('id', id)
  revalidatePath(`/admin/leads/${id}`)
}
