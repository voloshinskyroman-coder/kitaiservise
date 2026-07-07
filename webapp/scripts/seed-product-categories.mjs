#!/usr/bin/env node
// Загружает Google Product Taxonomy (ru-RU) — официальный бесплатный источник Google
// для Google Shopping — в таблицу product_categories, для автодополнения в квизе (tn.md).
// Формат строки: "ID - Категория > Подкатегория > ...". Перезапускаемо: используется upsert.
import fs from 'node:fs'
import path from 'node:path'
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

  console.log('Скачиваю Google Product Taxonomy (ru-RU)...')
  const res = await fetch('https://www.google.com/basepages/producttype/taxonomy-with-ids.ru-RU.txt')
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const text = await res.text()

  const records = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^(\d+)\s*-\s*(.+)$/)
    if (!match) continue
    const [, id, path] = match
    const segments = path.split('>').map((s) => s.trim())
    const leafName = segments[segments.length - 1]
    records.push({ id, path, leaf_name: leafName })
  }

  console.log(`Найдено ${records.length} категорий, загружаю в Supabase...`)

  const BATCH_SIZE = 500
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('product_categories').upsert(batch, { onConflict: 'id' })
    if (error) throw new Error(`Batch at offset ${i} failed: ${error.message}`)
    console.log(`  ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`)
  }

  console.log('Готово.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
