'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { LogistStatus } from '@/lib/types/shipment'

export async function setOutreachCrmStatus(contactId: number, crm_status: LogistStatus) {
  const supabase = createServerSupabaseClient()
  await supabase.from('outreach_contacts').update({ crm_status }).eq('id', contactId)
  revalidatePath('/admin')
}
