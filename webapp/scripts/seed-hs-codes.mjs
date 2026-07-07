#!/usr/bin/env node
// Загружает официальный классификатор ТН ВЭД ЕАЭС из открытых данных ФНС России
// (data.nalog.ru/files/tnved/tnved.zip) в таблицу hs_codes. Источник — TNVED4.Txt внутри
// архива, кодировка CP866, формат "глава|раздел|код|наименование|дата_с|дата_по" — берём
// только действующие сейчас записи (дата_по пустая). Перезапускаемо: используется upsert.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  const text = fs.readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

async function main() {
  const env = loadEnvLocal()
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не найдены в .env.local')
  }
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnved-'))
  const zipPath = path.join(tmpDir, 'tnved.zip')

  console.log('Скачиваю классификатор ТН ВЭД с data.nalog.ru (ФНС России)...')
  const res = await fetch('https://data.nalog.ru/files/tnved/tnved.zip')
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))

  execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'inherit' })
  const rawPath = path.join(tmpDir, 'TNVED4.Txt')
  const utf8Path = path.join(tmpDir, 'tnved4_utf8.txt')
  execSync(`iconv -f CP866 -t UTF-8 "${rawPath}" > "${utf8Path}"`, { shell: '/bin/bash' })

  const text = fs.readFileSync(utf8Path, 'utf8')
  const lines = text.split('\n')

  // С 2017 года новые записи используют укороченный иерархический текст ("- из хлопковой пряжи"),
  // а исторические записи того же (всё ещё действующего) кода часто содержат полное наименование —
  // берём самое длинное описание среди всех периодов, но код должен быть действующим сейчас.
  const byCode = new Map()
  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 6) continue
    const [chapter, group, code, description, , dateTo] = parts
    if (!/^\d{2}$/.test(chapter) || !/^\d{2}$/.test(group) || !/^\d{6}$/.test(code)) continue
    const fullCode = chapter + group + code
    const trimmed = description.trim()
    if (!trimmed) continue

    const isActive = dateTo === ''
    const existing = byCode.get(fullCode)
    if (!existing) {
      byCode.set(fullCode, { description: trimmed, chapter, hasActive: isActive })
    } else {
      if (isActive) existing.hasActive = true
      if (trimmed.length > existing.description.length) existing.description = trimmed
    }
  }

  const records = [...byCode.entries()]
    .filter(([, v]) => v.hasActive)
    .map(([code, v]) => ({ code, description: v.description, chapter: v.chapter }))
  console.log(`Найдено ${records.length} действующих кодов, загружаю в Supabase...`)

  const BATCH_SIZE = 500
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('hs_codes').upsert(batch, { onConflict: 'code' })
    if (error) throw new Error(`Batch at offset ${i} failed: ${error.message}`)
    console.log(`  ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`)
  }

  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log('Готово.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
