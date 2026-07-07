import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const BUCKET = 'shipment-documents'
const MAX_SIZE_BYTES = 10 * 1024 * 1024
// Excel/CSV/TXT прикрепляются и уходят логисту в Telegram как есть, без AI-разбора —
// AI-вложение работает только для изображений (см. ATTACHMENT_QUESTION_IDS в answer/route.ts).
const ALLOWED_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'text/plain': 'txt',
}

/** Загрузка вложения (инвойс/упаковочный лист) к сессии квиза — картинка сжата на клиенте. */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const sessionId = formData.get('sessionId')
  const file = formData.get('file')

  if (typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'sessionId обязателен' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file обязателен' }, { status: 400 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'Файл слишком большой (максимум 10 МБ)' }, { status: 400 })
  }
  const ext = ALLOWED_EXTENSIONS[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Неподдерживаемый формат файла' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()

  const { data: shipment } = await supabase.from('shipments').select('id, status').eq('id', sessionId).maybeSingle()
  if (!shipment || shipment.status === 'completed') {
    return NextResponse.json({ error: 'Сессия не найдена или уже завершена' }, { status: 404 })
  }

  const path = `${sessionId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  return NextResponse.json({ path, mimeType: file.type })
}
