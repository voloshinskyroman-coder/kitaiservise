import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const BUCKET = 'shipment-documents'

/** Бакет приватный — доступ к вложению (для AI-анализа, отправки в Telegram, просмотра в админке) только по временной подписанной ссылке. */
export async function getSignedAttachmentUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error || !data) return null
  return data.signedUrl
}
