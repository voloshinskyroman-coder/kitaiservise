'use client'

import { useState } from 'react'
import { LeadsTab } from './LeadsTab'
import { FunnelTab, type FunnelRow } from './FunnelTab'
import { OutreachDashboard } from './OutreachDashboard'
import { CrmBoard } from './CrmBoard'
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

  return (
    <div>
      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm transition-all ${
              tab === t.key ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-800 text-neutral-400'
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
