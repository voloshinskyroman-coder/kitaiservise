'use client'

import { useState } from 'react'
import { LeadsTab } from './LeadsTab'
import { FunnelTab, type FunnelRow } from './FunnelTab'
import { OutreachDashboard } from './OutreachDashboard'
import { CrmBoard } from './CrmBoard'
import { LogoutButton } from './LogoutButton'
import type { Shipment } from '@/lib/types/shipment'
import type { OutreachData } from '@/lib/queries/outreach'
import type { CrmCard } from '@/lib/queries/crm'

type Tab = 'leads' | 'funnel' | 'outreach' | 'crm'

const TABS: { key: Tab; label: string }[] = [
  { key: 'outreach', label: '📤 Рассылка' },
  { key: 'leads', label: '📋 Заявки' },
  { key: 'funnel', label: '🔻 Воронка' },
  { key: 'crm', label: '🗂 CRM' },
]

export function AdminTabs({
  leads,
  funnel,
  outreach,
  crm,
}: {
  leads: Shipment[]
  funnel: FunnelRow[]
  outreach: OutreachData
  crm: CrmCard[]
}) {
  const [tab, setTab] = useState<Tab>('outreach')
  // Раздел рассылки визуально повторяет Vellar Home (светлая кремовая тема) —
  // остальные разделы админки остаются в тёмной теме KitaiService.
  const isOutreach = tab === 'outreach'

  return (
    <div className={isOutreach ? 'min-h-screen bg-[#F5F0EB] p-8 text-[#1A1A1A]' : 'min-h-screen bg-neutral-950 p-8 text-neutral-100'}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Админ-панель KitaiService</h1>
        <LogoutButton light={isOutreach} />
      </div>

      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm transition-all ${
              tab === t.key
                ? isOutreach
                  ? 'bg-[#1A1A1A] text-white'
                  : 'bg-neutral-100 text-neutral-900'
                : isOutreach
                  ? 'border border-[#E0DBD5] text-[#666]'
                  : 'border border-neutral-800 text-neutral-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leads' && <LeadsTab leads={leads} />}
      {tab === 'funnel' && <FunnelTab rows={funnel} />}
      {tab === 'outreach' && <OutreachDashboard initialData={outreach} />}
      {tab === 'crm' && <CrmBoard initialCards={crm} />}
    </div>
  )
}
