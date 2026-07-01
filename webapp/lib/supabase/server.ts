import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Единственный способ доступа к БД — через service role на сервере.
// Клиент никогда не получает Supabase-ключи и не ходит в базу напрямую.
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase env vars отсутствуют: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
