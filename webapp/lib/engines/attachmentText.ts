import 'server-only'
import ExcelJS from 'exceljs'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const BUCKET = 'shipment-documents'
const MAX_TEXT_LENGTH = 6000

// exceljs читает только Open XML (.xlsx) — legacy бинарный .xls не поддерживается,
// такие файлы остаются просто вложением без AI-разбора (как PDF).
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const TEXT_EXTRACTABLE_MIME_TYPES = new Set([XLSX_MIME, 'text/csv', 'text/plain'])

// Ячейки с rich text/гиперссылками/формулами exceljs отдаёт объектом, не строкой.
function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)
  const obj = value as { richText?: Array<{ text?: string }>; text?: string; result?: unknown; hyperlink?: string }
  if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text ?? '').join('')
  if (typeof obj.text === 'string') return obj.text
  if (obj.result != null) return String(obj.result)
  if (obj.hyperlink) return obj.hyperlink
  return ''
}

function sheetToText(sheet: ExcelJS.Worksheet): string {
  const rows: string[] = []
  sheet.eachRow((row) => {
    const cells = (row.values as unknown[]).slice(1).map(cellToString)
    // Объединённые ячейки exceljs дублирует на весь диапазон — схлопываем повторы подряд,
    // иначе текст раздувается в разы и впустую жрёт токены AI.
    const deduped: string[] = []
    for (const cell of cells) {
      if (cell && deduped[deduped.length - 1] === cell) continue
      deduped.push(cell)
    }
    const line = deduped.filter(Boolean).join(' | ')
    // Вертикально объединённые ячейки повторяют содержимое на каждой строке диапазона —
    // та же дедупликация, что и по столбцам, только по соседним строкам.
    if (line && line !== rows[rows.length - 1]) rows.push(line)
  })
  return rows.join('\n')
}

/** Достаёт читаемый текст из вложения (инвойс/упаковочный лист) для передачи в AI — xlsx/csv/txt. */
export async function extractAttachmentText(path: string, mimeType: string): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error || !data) return null

  const arrayBuffer = await data.arrayBuffer()

  let text: string
  if (mimeType === XLSX_MIME) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(arrayBuffer)
    text = workbook.worksheets.map((sheet) => `# ${sheet.name}\n${sheetToText(sheet)}`).join('\n\n')
  } else {
    text = Buffer.from(arrayBuffer).toString('utf-8')
  }

  const trimmed = text.trim()
  if (!trimmed) return null
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed
}
