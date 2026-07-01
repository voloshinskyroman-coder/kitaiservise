import Link from 'next/link'
import { getPurposeLabel } from '@/lib/config/decisionTree'
import { DELIVERY_MODE_LABEL } from '@/lib/engines/logisticLabels'
import type { Shipment } from '@/lib/types/shipment'

export type FunnelRow = Pick<
  Shipment,
  'id' | 'status' | 'purpose' | 'delivery_mode' | 'answers_log' | 'telegram_user_id' | 'telegram_username' | 'created_at' | 'updated_at'
>
type FunnelStage = 'opened' | 'answering' | 'submitted'

function getStage(s: Pick<Shipment, 'status' | 'answers_log'>): FunnelStage {
  if (s.status === 'completed') return 'submitted'
  if (s.answers_log.length > 0) return 'answering'
  return 'opened'
}

const STAGE_LABEL: Record<FunnelStage, string> = {
  opened: '📱 Открыл',
  answering: '✍️ Отвечает',
  submitted: '✅ Подал заявку',
}

const STAGE_COLOR: Record<FunnelStage, string> = {
  opened: 'bg-neutral-800 text-neutral-300',
  answering: 'bg-blue-950 text-blue-300',
  submitted: 'bg-green-950 text-green-300',
}

function fmt(d: string) {
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function FunnelTab({ rows }: { rows: FunnelRow[] }) {
  const counts = {
    all: rows.length,
    opened: rows.filter((s) => getStage(s) === 'opened').length,
    answering: rows.filter((s) => getStage(s) === 'answering').length,
    submitted: rows.filter((s) => getStage(s) === 'submitted').length,
  }
  const conversion = counts.all > 0 ? Math.round((counts.submitted / counts.all) * 100) : 0

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Всего открыли', value: counts.all },
          { label: '📱 Открыл, не начал', value: counts.opened },
          { label: '✍️ Отвечает', value: counts.answering },
          { label: '✅ Подал заявку', value: counts.submitted },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="mt-1 text-xs text-neutral-500">{c.label}</div>
          </div>
        ))}
      </div>

      <p className="mb-4 text-sm text-neutral-400">
        Конверсия из открытия в заявку: <span className="font-semibold text-neutral-100">{conversion}%</span>
      </p>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3">Открыл</th>
              <th className="px-4 py-3">Клиент</th>
              <th className="px-4 py-3">Стадия</th>
              <th className="px-4 py-3">Цель</th>
              <th className="px-4 py-3">Способ</th>
              <th className="px-4 py-3">Ответов</th>
              <th className="px-4 py-3">Активность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const stage = getStage(s)
              return (
                <tr key={s.id} className="border-t border-neutral-800 hover:bg-neutral-900">
                  <td className="px-4 py-3 text-neutral-400">{fmt(s.created_at)}</td>
                  <td className="px-4 py-3">
                    {stage === 'submitted' ? (
                      <Link href={`/admin/leads/${s.id}`} className="text-neutral-100 underline">
                        {s.telegram_username ? `@${s.telegram_username}` : `id${s.telegram_user_id ?? '—'}`}
                      </Link>
                    ) : (
                      <span>{s.telegram_username ? `@${s.telegram_username}` : `id${s.telegram_user_id ?? '—'}`}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STAGE_COLOR[stage]}`}>{STAGE_LABEL[stage]}</span>
                  </td>
                  <td className="px-4 py-3">{s.purpose ? getPurposeLabel(s.purpose) : '—'}</td>
                  <td className="px-4 py-3">{s.delivery_mode ? DELIVERY_MODE_LABEL[s.delivery_mode] : '—'}</td>
                  <td className="px-4 py-3">{s.answers_log.length}</td>
                  <td className="px-4 py-3 text-neutral-400">{fmt(s.updated_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-neutral-500">Пока никто не открывал Mini App.</p>}
      </div>
    </div>
  )
}
