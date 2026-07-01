'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { CrmCard } from '@/lib/queries/crm'
import { setLogistStatus } from '@/lib/actions/shipments'
import { setOutreachCrmStatus } from '@/lib/actions/outreach'
import type { LogistStatus } from '@/lib/types/shipment'

const STATUS_LABEL: Record<LogistStatus, string> = { new: '🆕 Новые', contacted: '✉️ В работе', closed: '✅ Закрыты' }
const STATUSES: LogistStatus[] = ['new', 'contacted', 'closed']

const SOURCE_BADGE: Record<CrmCard['source'], { label: string; className: string }> = {
  shipment: { label: '📱 Mini App', className: 'bg-blue-950 text-blue-300' },
  outreach: { label: '📤 Рассылка', className: 'bg-purple-950 text-purple-300' },
}

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function CrmBoard({ initialCards }: { initialCards: CrmCard[] }) {
  const [cards, setCards] = useState(initialCards)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function changeStatus(card: CrmCard, status: LogistStatus) {
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, status } : c)))
    if (card.source === 'shipment') {
      await setLogistStatus(card.id.replace('shipment:', ''), status)
    } else {
      await setOutreachCrmStatus(Number(card.id.replace('outreach:', '')), status)
    }
  }

  const filtered = cards.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q)
  })

  const selected = filtered.find((c) => c.id === selectedId) ?? null

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <input
          placeholder="Поиск по имени или @username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none"
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {STATUSES.map((status) => {
            const columnCards = filtered.filter((c) => c.status === status)
            return (
              <div key={status}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-neutral-400">{STATUS_LABEL[status]}</h2>
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">{columnCards.length}</span>
                </div>
                <div className="space-y-2">
                  {columnCards.map((c) => {
                    const badge = SOURCE_BADGE[c.source]
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full rounded-2xl border p-3.5 text-left transition-all ${selectedId === c.id ? 'border-neutral-100 bg-neutral-900' : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700'}`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold">{c.name}</div>
                          <div className="shrink-0 text-[10px] text-neutral-500">{fmt(c.lastActivity)}</div>
                        </div>
                        <div className="mb-2 truncate text-xs text-neutral-400">{c.summary || '—'}</div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
                      </button>
                    )
                  })}
                  {columnCards.length === 0 && <p className="text-xs text-neutral-600">Пусто</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="w-96 shrink-0 rounded-2xl border border-neutral-800 bg-neutral-900">
        {!selected ? (
          <div className="flex h-64 items-center justify-center text-sm text-neutral-600">Выберите карточку</div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="border-b border-neutral-800 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{selected.name}</div>
                  {selected.username && (
                    <a href={`https://t.me/${selected.username}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">
                      @{selected.username}
                    </a>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SOURCE_BADGE[selected.source].className}`}>{SOURCE_BADGE[selected.source].label}</span>
              </div>

              <div className="mt-3 flex gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => void changeStatus(selected, s)}
                    disabled={selected.status === s}
                    className={`rounded-full px-2.5 py-1 text-xs ${selected.status === s ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              {selected.leadHref && (
                <Link href={selected.leadHref} className="mt-3 inline-block text-xs text-neutral-400 underline hover:text-neutral-200">
                  Открыть заявку →
                </Link>
              )}
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {selected.messages.length === 0 ? (
                <p className="text-xs text-neutral-600">{selected.source === 'shipment' ? 'Переписки нет — детали в заявке.' : 'Сообщений нет'}</p>
              ) : (
                selected.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.direction === 'out' ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-800 bg-neutral-950'}`}>
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="mt-1 text-[10px] opacity-60">{fmt(m.date)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
