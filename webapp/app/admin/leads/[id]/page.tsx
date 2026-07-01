import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getPurposeLabel } from '@/lib/config/decisionTree'
import { ACCURACY_LABEL } from '@/lib/engines/recommendationEngine'
import { formatPrice, formatDays, DELIVERY_MODE_LABEL, TEMPERATURE_EMOJI } from '@/lib/engines/logisticEngine'
import type { Shipment, LogistStatus } from '@/lib/types/shipment'

const LOGIST_STATUS_LABEL: Record<LogistStatus, string> = { new: 'Новая', contacted: 'В работе', closed: 'Закрыта' }

async function setLogistStatus(id: string, logist_status: LogistStatus) {
  'use server'
  const supabase = createServerSupabaseClient()
  await supabase.from('shipments').update({ logist_status }).eq('id', id)
  revalidatePath(`/admin/leads/${id}`)
  revalidatePath('/admin/leads')
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between border-b border-neutral-800 py-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-100">{value}</span>
    </div>
  )
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerSupabaseClient()
  const { data: lead } = await supabase.from('shipments').select('*').eq('id', id).single<Shipment>()

  if (!lead) notFound()

  const temperature = lead.lead_temperature ?? 'cold'

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-neutral-950 p-8 text-neutral-100">
      <Link href="/admin/leads" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Все лиды
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">
        {TEMPERATURE_EMOJI[temperature]} {getPurposeLabel(lead.purpose)}
      </h1>
      <p className="mt-1 text-neutral-400">
        {lead.telegram_username ? `@${lead.telegram_username}` : `Telegram id${lead.telegram_user_id ?? '—'}`}
      </p>

      <div className="mt-4 flex gap-2">
        {(['new', 'contacted', 'closed'] as LogistStatus[]).map((s) => (
          <form key={s} action={setLogistStatus.bind(null, lead.id, s)}>
            <button
              type="submit"
              disabled={lead.logist_status === s}
              className={`rounded-full px-3 py-1 text-sm ${
                lead.logist_status === s ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-800 text-neutral-300'
              }`}
            >
              {LOGIST_STATUS_LABEL[s]}
            </button>
          </form>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-neutral-800 p-4">
        <Field label="Категория" value={lead.category} />
        <Field label="Товар" value={lead.product_description} />
        <Field label="Поставщик" value={lead.supplier} />
        <Field label="Откуда" value={lead.origin_city} />
        <Field label="Способ доставки" value={lead.delivery_mode ? DELIVERY_MODE_LABEL[lead.delivery_mode] : null} />
        <Field label="Вес" value={lead.weight_kg != null ? `${lead.weight_kg} кг` : null} />
        <Field label="Объём" value={lead.volume_m3 != null ? `${lead.volume_m3.toFixed(3)} м³` : null} />
        <Field label="Стоимость товара" value={lead.product_cost != null ? `${lead.product_cost.toLocaleString('ru-RU')} ₽` : null} />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 p-4">
        <Field label="Расчёт" value={`${formatPrice(lead)} (${ACCURACY_LABEL[lead.calculation_accuracy ?? 'low']})`} />
        <Field label="Маршрут" value={lead.estimated_route} />
        <Field label="Срок" value={formatDays(lead)} />
        <Field label="Скоринг" value={`${lead.lead_score} (${temperature})`} />
      </div>

      {lead.system_comments && (
        <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-200">
          💬 {lead.system_comments}
        </p>
      )}

      <details className="mt-4 rounded-xl border border-neutral-800 p-4">
        <summary className="cursor-pointer text-sm text-neutral-400">История ответов ({lead.answers_log.length})</summary>
        <ol className="mt-3 space-y-1 text-sm text-neutral-300">
          {lead.answers_log.map((entry, i) => (
            <li key={i}>
              <span className="text-neutral-500">{entry.question_id}:</span> {String(entry.answer)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}
