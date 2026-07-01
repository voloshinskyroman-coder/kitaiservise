'use client'

import Link from 'next/link'
import { useState } from 'react'
import { getPurposeLabel } from '@/lib/config/decisionTree'
import { formatPrice, TEMPERATURE_EMOJI } from '@/lib/engines/logisticLabels'
import type { Shipment, LogistStatus } from '@/lib/types/shipment'

const LOGIST_STATUS_LABEL: Record<LogistStatus, string> = { new: 'Новая', contacted: 'В работе', closed: 'Закрыта' }
const FILTERS: { value: LogistStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'contacted', label: 'В работе' },
  { value: 'closed', label: 'Закрытые' },
]

export function LeadsTab({ leads }: { leads: Shipment[] }) {
  const [filter, setFilter] = useState<LogistStatus | 'all'>('all')
  const filtered = filter === 'all' ? leads : leads.filter((l) => l.logist_status === filter)

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f.value ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-800 text-neutral-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Клиент</th>
              <th className="px-4 py-3">Запрос</th>
              <th className="px-4 py-3">Способ</th>
              <th className="px-4 py-3">Цена</th>
              <th className="px-4 py-3">Скоринг</th>
              <th className="px-4 py-3">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr key={lead.id} className="border-t border-neutral-800 hover:bg-neutral-900">
                <td className="px-4 py-3 text-neutral-400">{new Date(lead.created_at).toLocaleString('ru-RU')}</td>
                <td className="px-4 py-3">
                  <Link href={`/admin/leads/${lead.id}`} className="text-neutral-100 underline">
                    {lead.telegram_username ? `@${lead.telegram_username}` : `id${lead.telegram_user_id ?? '—'}`}
                  </Link>
                </td>
                <td className="px-4 py-3">{getPurposeLabel(lead.purpose)}</td>
                <td className="px-4 py-3">{lead.delivery_mode ?? '—'}</td>
                <td className="px-4 py-3">{formatPrice(lead)}</td>
                <td className="px-4 py-3">
                  {TEMPERATURE_EMOJI[lead.lead_temperature ?? 'cold']} {lead.lead_score}
                </td>
                <td className="px-4 py-3">{LOGIST_STATUS_LABEL[lead.logist_status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="p-4 text-neutral-500">Пока нет заявок.</p>}
      </div>
    </div>
  )
}
