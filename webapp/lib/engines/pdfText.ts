import 'server-only'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const BUCKET = 'shipment-documents'
const MAX_TEXT_LENGTH = 6000
const MAX_PAGES = 10

/**
 * Достаёт текстовый слой PDF (см. attachmentText.ts — тот же смысл, для xlsx/csv/txt).
 * Сканы/фото без текстового слоя возвращают null — это MVP-ограничение, для них нужен OCR,
 * не реализован.
 */
export async function extractPdfText(path: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null

  const arrayBuffer = await data.arrayBuffer()
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pageCount = Math.min(doc.numPages, MAX_PAGES)
  const chunks: string[] = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim()
    if (pageText) chunks.push(pageText)
  }

  const text = chunks.join('\n\n').trim()
  if (!text) return null
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}
