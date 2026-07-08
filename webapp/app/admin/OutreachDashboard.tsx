'use client'

import { Fragment, useEffect, useState } from 'react'
import type { OutreachAccount, OutreachData } from '@/lib/queries/outreach'
import { classifyReply } from '@/lib/config/replySentiment'

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-neutral-800 text-neutral-400',
  sent: 'bg-blue-950 text-blue-300',
  replied: 'bg-green-950 text-green-300',
  skipped: 'bg-yellow-950 text-yellow-300',
  failed: 'bg-red-950 text-red-300',
}
const STATUS_RU: Record<string, string> = {
  new: 'Новый', sent: 'Отправлено', replied: 'Ответил', skipped: 'Пропущен', failed: 'Ошибка',
}

function fmt(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
function sessionToName(session: string) {
  return session.replace('manager_', '+').replace('account_', '+')
}

type Tier = 'purple' | 'orange' | 'green' | 'blue' | 'yellow' | 'red' | 'new' | 'black'

const TIER_RANGE: Record<Tier, [number, number]> = {
  purple: [8, 10], orange: [6, 8], green: [4, 6], blue: [2, 4], yellow: [0, 1], red: [0, 0], new: [0, 0], black: [0, 0],
}

function todayLimit(session: string, tier: Tier): number {
  const [lo, hi] = TIER_RANGE[tier]
  if (lo === hi) return lo
  const today = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''))
  let h = 0
  for (let i = 0; i < session.length; i++) h = (Math.imul(31, h) + session.charCodeAt(i)) | 0
  const seed = (h ^ today) >>> 0
  const r = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return lo + (r % (hi - lo + 1))
}

function getAccountTier(acc: OutreachAccount): Tier {
  const now = new Date()
  if (acc.status === 'dead') return 'black'
  if (acc.paused_until) {
    const pu = new Date(acc.paused_until)
    if (pu > now) return 'red'
    if (now.getTime() - pu.getTime() < 86_400_000) return 'yellow'
  }
  if (acc.status === 'paused') return 'red'
  if (!acc.avatar_url) return 'new'
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const createdDate = acc.created_at ? new Date(acc.created_at) : null
  const createdUTC = createdDate ? Date.UTC(createdDate.getUTCFullYear(), createdDate.getUTCMonth(), createdDate.getUTCDate()) : 0
  const ageDays = createdDate ? (todayUTC - createdUTC) / 86_400_000 : Infinity
  if (ageDays <= 1) return 'new'
  if (ageDays <= 6) return 'blue'
  if (ageDays <= 13) return 'green'
  if (ageDays <= 20) return 'orange'
  return 'purple'
}

function ageDays(acc: OutreachAccount): number | null {
  if (!acc.created_at) return null
  const now = new Date()
  const created = new Date(acc.created_at)
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const createdUTC = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate())
  return Math.floor((todayUTC - createdUTC) / 86_400_000) + 1
}

function recommendation(acc: OutreachAccount, stats: { sent: number; rate: number | null }) {
  const tier = getAccountTier(acc)
  if (acc.status === 'disconnected') return { text: 'Сессия протухла — нужна переавторизация через QR', color: 'text-orange-300 bg-orange-950/40' }
  if (acc.status === 'auth_error') return { text: 'Auth key отозван — нужна переавторизация через QR', color: 'text-orange-300 bg-orange-950/40' }
  if (tier === 'black') return { text: 'Сессия убита — ничего не пишем, нужна авторизация', color: 'text-neutral-400 bg-black' }
  if (tier === 'new') return { text: 'Новый аккаунт — дни 1-2, полная тишина', color: 'text-neutral-400 bg-neutral-900' }
  if (tier === 'red') return { text: `Заморожен — ничего не пишем, ждём 24ч${acc.paused_until ? `. Выйдет ${fmt(acc.paused_until)}` : ''}`, color: 'text-red-300 bg-red-950/40' }
  if (tier === 'yellow') return { text: 'Предупреждение было < 24ч назад — притормаживаем, макс 2/день', color: 'text-yellow-300 bg-yellow-950/40' }
  if (tier === 'blue') {
    const d = ageDays(acc) ?? 2
    return { text: `День ${d} — прогрев, не более 3 сообщений/день`, color: 'text-blue-300 bg-blue-950/40' }
  }
  if (tier === 'green') {
    const d = ageDays(acc) ?? 8
    return { text: `День ${d} — нарабатываем историю, до 5/день`, color: 'text-green-300 bg-green-950/40' }
  }
  if (tier === 'orange') {
    const d = ageDays(acc) ?? 15
    return { text: `День ${d} — ускоряемся, до 7/день`, color: 'text-orange-300 bg-orange-950/40' }
  }
  const d = ageDays(acc) ?? 22
  if (stats.sent >= 40) return { text: `День ${d} — грузим по максимуму: ${stats.sent} DM, конверсия ${stats.rate ?? 0}%`, color: 'text-purple-300 bg-purple-950/40' }
  return { text: `День ${d} — грузим по максимуму, до 10/день`, color: 'text-purple-300 bg-purple-950/40' }
}

const TIER_META: Record<Tier, { label: string; action: string; headerBg: string; countBg: string }> = {
  purple: { label: '🟣 Топ-аккаунты', action: 'День 22+ — грузим по максимуму, до 10/день', headerBg: 'border-purple-900 bg-purple-950/40', countBg: 'bg-purple-900 text-purple-300' },
  orange: { label: '🟠 Ускоряемся', action: 'Дни 15-21 — ускоряемся, до 7/день', headerBg: 'border-orange-900 bg-orange-950/40', countBg: 'bg-orange-900 text-orange-300' },
  green: { label: '🟢 Нарабатываем', action: 'Дни 8-14 — нарабатываем историю, до 5/день', headerBg: 'border-green-900 bg-green-950/40', countBg: 'bg-green-900 text-green-300' },
  blue: { label: '🔵 Прогрев', action: 'Дни 3-7 — прогрев, не более 3 сообщений/день', headerBg: 'border-blue-900 bg-blue-950/40', countBg: 'bg-blue-900 text-blue-300' },
  new: { label: '⚪ Дни 1-2 — отлёжка', action: 'Первые два дня — полная тишина', headerBg: 'border-neutral-800 bg-neutral-900', countBg: 'bg-neutral-800 text-neutral-300' },
  yellow: { label: '🟡 Предупреждение', action: 'Был PeerFlood < 24ч назад — только прогрев, макс 2/день', headerBg: 'border-yellow-900 bg-yellow-950/40', countBg: 'bg-yellow-900 text-yellow-300' },
  red: { label: '🔴 Заморожены', action: 'PeerFlood активен — ничего не пишем, ждём 24ч', headerBg: 'border-red-900 bg-red-950/40', countBg: 'bg-red-900 text-red-300' },
  black: { label: '💀 Мёртвые', action: 'Сессия убита Telegram — нужна авторизация', headerBg: 'border-neutral-700 bg-black', countBg: 'bg-neutral-700 text-neutral-300' },
}

function AccountCard({ acc, sentByAccount }: { acc: OutreachAccount; sentByAccount: Map<string, { sent: number; replied: number }> }) {
  const tier = getAccountTier(acc)
  const limit = acc.daily_limit || todayLimit(acc.session, tier)
  const pct = limit === 0 ? 0 : Math.min(100, Math.round(((acc.sent_today || 0) / limit) * 100))
  const remaining = Math.max(0, limit - (acc.sent_today || 0))
  const isPaused = tier === 'black' || tier === 'new' || acc.status === 'disconnected' || acc.status === 'auth_error'
  const lifetime = sentByAccount.get(acc.session) ?? { sent: 0, replied: 0 }
  const rate = lifetime.sent > 0 ? Math.round((lifetime.replied / lifetime.sent) * 100) : null
  const rec = recommendation(acc, { sent: lifetime.sent, rate })

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-2">
        {acc.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={acc.avatar_url} alt="" className={`h-9 w-9 shrink-0 rounded-full object-cover ${tier === 'black' ? 'opacity-50 grayscale' : ''}`} />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-neutral-400">
            {(acc.name ?? 'A')[0]}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{acc.name ?? sessionToName(acc.session)}</div>
          {acc.phone && <div className="text-xs text-neutral-500">{acc.phone}</div>}
          <div className="text-xs text-neutral-500">
            {acc.gender === 'female' ? '♀' : '♂'} · {limit === 0 ? 'не пишем' : `сегодня ${limit}`}
          </div>
        </div>
      </div>

      {isPaused ? (
        <div className="rounded-xl bg-neutral-800 px-3 py-2 text-center text-xs font-medium text-neutral-300">
          {acc.status === 'disconnected' ? '⚡ Сессия протухла — нужен QR' : acc.status === 'auth_error' ? '⚡ Auth key отозван — нужен QR' : tier === 'black' ? '💀 Сессия убита Telegram' : '⏳ День 1 — полная отлёжка'}
        </div>
      ) : (
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-neutral-500">Отправлено: <b className="text-neutral-100">{acc.sent_today ?? 0}</b> / {limit}</span>
            {remaining > 0 ? <span className="font-semibold text-neutral-300">+{remaining} план</span> : <span className="text-neutral-500">лимит выполнен</span>}
          </div>
          <div className="h-1.5 w-full rounded-full bg-neutral-800">
            <div className="h-1.5 rounded-full bg-neutral-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex gap-3 border-t border-neutral-800 pt-2 text-xs">
        <span className="text-neutral-500">Всего: <b className="text-neutral-100">{lifetime.sent}</b></span>
        {lifetime.sent > 0 && (
          <span className="text-neutral-500">
            Ответов: <b className={rate !== null && rate >= 10 ? 'text-green-400' : 'text-neutral-300'}>{lifetime.replied} {rate !== null ? `(${rate}%)` : ''}</b>
          </span>
        )}
        {(acc.flood_count ?? 0) > 0 && (
          <span className="ml-auto rounded-full bg-red-950 px-2 py-0.5 text-xs font-semibold text-red-300">🚨 флуд ×{acc.flood_count}</span>
        )}
      </div>

      <div className={`rounded-lg px-2.5 py-1.5 text-xs font-medium leading-snug ${rec.color}`}>
        {rec.text}
      </div>
    </div>
  )
}

export function OutreachDashboard({ initialData }: { initialData: OutreachData }) {
  const [data, setData] = useState<OutreachData>(initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  async function refresh() {
    setRefreshing(true)
    const res = await fetch('/api/admin/outreach', { cache: 'no-store' })
    if (res.ok) setData(await res.json())
    setRefreshing(false)
  }

  useEffect(() => {
    // Только подписка на внешний источник по таймеру — начальные данные уже пришли с сервера.
    const interval = setInterval(() => { void refresh() }, 60_000)
    return () => clearInterval(interval)
  }, [])

  const { accounts, contacts, conversations, activity, messages, synced_at, stats } = data

  const sentByAccount = new Map<string, { sent: number; replied: number }>()
  for (const c of contacts) {
    if (!c.account_session) continue
    const cur = sentByAccount.get(c.account_session) ?? { sent: 0, replied: 0 }
    if (c.status === 'sent' || c.status === 'replied') cur.sent += 1
    if (c.status === 'replied') cur.replied += 1
    sentByAccount.set(c.account_session, cur)
  }

  const tiers = (['purple', 'orange', 'green', 'blue', 'new', 'yellow', 'red', 'black'] as Tier[]).map((key) => ({
    key,
    accs: accounts.filter((a) => (key === 'black' ? a.status === 'dead' : getAccountTier(a) === key)),
  }))

  const filteredContacts = contacts.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (c.username ?? '').toLowerCase().includes(q) || c.tg_id.includes(q)
    }
    return true
  })

  const proxyEvents = activity.filter((a) => a.type === 'proxy_down' || a.type === 'proxy_up').sort((a, b) => b.done_at.localeCompare(a.done_at))
  const openConversations = conversations.filter((c) => c.status === 'open')

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-neutral-500">Синк: {fmt(synced_at)}{refreshing && ' · обновляю...'}</p>
        <button onClick={() => void refresh()} className="rounded-xl border border-neutral-800 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200">
          Обновить
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Сегодня</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Отправлено', value: stats.sent_today },
            { label: 'Ответили', value: stats.replied_today },
            { label: 'Конверсия', value: `${stats.conversion_today}%` },
            { label: 'Сообщений', value: stats.messages_today },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="mt-1 text-xs text-neutral-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Всего</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: 'В базе', value: contacts.length },
            { label: 'Новых', value: stats.new_all },
            { label: 'Отправлено', value: stats.sent_all },
            { label: 'Ответили', value: stats.replied_all },
            { label: 'Конверсия', value: stats.sent_all > 0 ? `${Math.round((stats.replied_all / stats.sent_all) * 100)}%` : '0%' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="mt-1 text-xs text-neutral-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-400">Аккаунты</h2>
        {accounts.length === 0 && <p className="text-sm text-neutral-500">Нет аккаунтов — bots/outreach ещё не подключён к KitaiService.</p>}
        {tiers.map((t) => {
          if (t.accs.length === 0) return null
          const meta = TIER_META[t.key]
          return (
            <div key={t.key}>
              <div className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 ${meta.headerBg}`}>
                <span className="text-sm font-bold">{meta.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.countBg}`}>{t.accs.length} акк.</span>
                <span className="ml-auto text-xs text-neutral-500">{meta.action}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {t.accs.map((acc) => <AccountCard key={acc.id} acc={acc} sentByAccount={sentByAccount} />)}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-400">🔌 Прокси сегодня</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-800">
          {proxyEvents.length === 0 ? (
            <div className="px-4 py-3 text-xs font-medium text-green-400">✅ Все прокси работают штатно (или нет данных синка)</div>
          ) : (
            proxyEvents.map((e, i) => {
              const acc = accounts.find((a) => a.session === e.session)
              const name = acc?.name ?? e.session.replace('manager_', '')
              const isDown = e.type === 'proxy_down'
              return (
                <div key={i} className={`flex items-center gap-3 border-b border-neutral-900 px-4 py-2.5 text-xs last:border-0 ${isDown ? 'bg-red-950/30' : 'bg-green-950/20'}`}>
                  <span>{isDown ? '🔴' : '🟢'}</span>
                  <span className="w-24 shrink-0 font-medium">{name}</span>
                  <span className="flex-1 text-neutral-400">{e.detail}</span>
                  <span className="whitespace-nowrap text-neutral-500">{new Date(e.done_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {openConversations.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-neutral-400">Открытые диалоги ({openConversations.length})</h2>
          <div className="space-y-2">
            {openConversations.map((conv) => {
              const clientMsgs = messages.filter((m) => m.contact_id === conv.contact_id && m.direction === 'in').sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
              return (
                <div key={conv.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">@{conv.outreach_contacts?.username ?? conv.contact_id}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">{fmt(conv.updated_at)}</div>
                    </div>
                    {conv.outreach_contacts?.username && (
                      <a href={`https://t.me/${conv.outreach_contacts.username}`} target="_blank" rel="noreferrer" className="rounded-full bg-blue-900 px-3 py-1 text-xs text-blue-100">✍️ Написать</a>
                    )}
                  </div>
                  {clientMsgs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {clientMsgs.map((m) => (
                        <div key={m.id} className="rounded-xl border border-green-900 bg-green-950/30 px-3 py-2 text-xs leading-relaxed">{m.text}</div>
                      ))}
                    </div>
                  )}
                  {conv.ai_draft && (
                    <div className="mt-3 rounded-xl bg-neutral-800 p-3 text-xs leading-relaxed text-neutral-300">🤖 {conv.ai_draft}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-400">Контакты</h2>
          <div className="flex flex-wrap gap-1.5">
            {['all', 'new', 'sent', 'replied', 'skipped', 'failed'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-all ${statusFilter === s ? 'border-transparent bg-neutral-100 text-neutral-900' : 'border-neutral-800 text-neutral-400'}`}
              >
                {s === 'all' ? 'Все' : STATUS_RU[s]}
              </button>
            ))}
          </div>
          <input
            placeholder="Поиск @username или ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto w-52 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs outline-none"
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-neutral-400">
                <tr>
                  {['Username', 'Статус', 'Сообщение клиента', 'Менеджер', 'Отправлено', 'Ответил'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.slice(0, 300).map((c) => {
                  const contactMsgs = messages.filter((m) => m.contact_id === c.id).sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
                  const lastInMsg = [...contactMsgs].reverse().find((m) => m.direction === 'in') ?? null
                  const manager = accounts.find((a) => a.session === c.account_session) ?? null
                  const isSelected = selectedId === c.id
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setSelectedId(isSelected ? null : c.id)}
                        className={`cursor-pointer border-t border-neutral-900 transition-colors ${isSelected ? 'bg-neutral-900' : 'hover:bg-neutral-900/60'}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.username ? `@${c.username}` : c.tg_id}</span>
                            <a
                              href={c.username ? `https://t.me/${c.username}` : `tg://user?id=${c.tg_id}`}
                              target="_blank" rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="whitespace-nowrap rounded-lg border border-blue-900 px-2 py-0.5 text-xs text-blue-300"
                            >
                              ✍️ Написать
                            </a>
                          </div>
                          <div className="text-xs text-neutral-600">{c.tg_id}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          {c.status === 'replied' && lastInMsg ? (
                            classifyReply(lastInMsg.text) === 'green' ? (
                              <span className="rounded-full bg-green-950 px-2 py-0.5 text-xs font-medium text-green-300">✅ Интерес</span>
                            ) : classifyReply(lastInMsg.text) === 'red' ? (
                              <span className="rounded-full bg-red-950 px-2 py-0.5 text-xs font-medium text-red-300">❌ Отказ</span>
                            ) : (
                              <span className="rounded-full bg-green-950 px-2 py-0.5 text-xs font-medium text-green-300">💬 Ответил</span>
                            )
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status] ?? 'bg-neutral-800 text-neutral-400'}`}>{STATUS_RU[c.status] ?? c.status}</span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-2.5">
                          {lastInMsg ? <div className="max-w-[200px] truncate text-xs text-neutral-400">{lastInMsg.text}</div> : <span className="text-xs text-neutral-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {manager ? (
                            <div>
                              <div className="text-xs font-medium">{manager.name ?? sessionToName(manager.session)}</div>
                              {manager.phone && <div className="text-xs text-neutral-500">{manager.phone}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-700">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">{fmt(c.sent_at)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-neutral-500">{fmt(c.replied_at)}</td>
                      </tr>
                      {isSelected && (
                        <tr key={`${c.id}-chat`} className="bg-neutral-900">
                          <td colSpan={6} className="px-6 py-4">
                            {contactMsgs.length === 0 ? (
                              <div className="text-xs text-neutral-500">Сообщений нет</div>
                            ) : (
                              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                                {contactMsgs.map((m) => (
                                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.direction === 'out' ? 'bg-neutral-100 text-neutral-900' : 'border border-neutral-800 bg-neutral-950 text-neutral-100'}`}>
                                      <div className="whitespace-pre-wrap">{m.text}</div>
                                      <div className="mt-1 text-[10px] opacity-60">{m.sent_at ? new Date(m.sent_at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filteredContacts.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-neutral-500">Нет контактов</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredContacts.length > 300 && (
            <div className="border-t border-neutral-800 px-4 py-3 text-xs text-neutral-500">Показано 300 из {filteredContacts.length} — уточните фильтр</div>
          )}
        </div>
      </div>
    </div>
  )
}
