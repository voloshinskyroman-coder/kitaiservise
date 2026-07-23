'use client'

import { Fragment, useEffect, useState } from 'react'
import type { OutreachAccount, OutreachContact, OutreachData } from '@/lib/queries/outreach'

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-500',
  sent: 'bg-blue-100 text-blue-700',
  replied: 'bg-green-100 text-green-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
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
  if (acc.status === 'disconnected') return { text: 'Сессия протухла — нужна переавторизация через QR', color: 'text-orange-700 bg-orange-50' }
  if (acc.status === 'auth_error') return { text: 'Auth key отозван — нужна переавторизация через QR', color: 'text-orange-700 bg-orange-50' }
  if (tier === 'black') return { text: 'Сессия убита — ничего не пишем, нужна авторизация', color: 'text-gray-300 bg-gray-800' }
  if (tier === 'new') return { text: 'Новый аккаунт — дни 1-2, полная тишина', color: 'text-gray-500 bg-gray-50' }
  if (tier === 'red') return { text: `Заморожен — ничего не пишем, ждём 24ч${acc.paused_until ? `. Выйдет ${fmt(acc.paused_until)}` : ''}`, color: 'text-red-600 bg-red-50' }
  if (tier === 'yellow') return { text: 'Предупреждение было < 24ч назад — притормаживаем, макс 2/день', color: 'text-yellow-800 bg-yellow-50' }
  if (tier === 'blue') {
    const d = ageDays(acc) ?? 2
    return { text: `День ${d} — прогрев, не более 3 сообщений/день`, color: 'text-blue-700 bg-blue-50' }
  }
  if (tier === 'green') {
    const d = ageDays(acc) ?? 8
    return { text: `День ${d} — нарабатываем историю, до 5/день`, color: 'text-green-700 bg-green-50' }
  }
  if (tier === 'orange') {
    const d = ageDays(acc) ?? 15
    return { text: `День ${d} — ускоряемся, до 7/день`, color: 'text-orange-700 bg-orange-50' }
  }
  const d = ageDays(acc) ?? 22
  if (stats.sent >= 40) return { text: `День ${d} — грузим по максимуму: ${stats.sent} DM, конверсия ${stats.rate ?? 0}%`, color: 'text-purple-700 bg-purple-50' }
  return { text: `День ${d} — грузим по максимуму, до 10/день`, color: 'text-purple-700 bg-purple-50' }
}

const TIER_META: Record<Tier, { label: string; action: string; headerBg: string; countBg: string }> = {
  purple: { label: '🟣 Топ-аккаунты', action: 'День 22+ — грузим по максимуму, до 10/день', headerBg: 'bg-purple-50 border-purple-200', countBg: 'bg-purple-100 text-purple-700' },
  orange: { label: '🟠 Ускоряемся', action: 'Дни 15-21 — ускоряемся, до 7/день', headerBg: 'bg-orange-50 border-orange-200', countBg: 'bg-orange-100 text-orange-700' },
  green: { label: '🟢 Нарабатываем', action: 'Дни 8-14 — нарабатываем историю, до 5/день', headerBg: 'bg-green-50 border-green-200', countBg: 'bg-green-100 text-green-700' },
  blue: { label: '🔵 Прогрев', action: 'Дни 3-7 — прогрев, не более 3 сообщений/день', headerBg: 'bg-blue-50 border-blue-200', countBg: 'bg-blue-100 text-blue-700' },
  new: { label: '⚪ Дни 1-2 — отлёжка', action: 'Первые два дня — полная тишина', headerBg: 'bg-gray-50 border-gray-200', countBg: 'bg-gray-100 text-gray-600' },
  yellow: { label: '🟡 Предупреждение', action: 'Был PeerFlood < 24ч назад — только прогрев, макс 2/день', headerBg: 'bg-yellow-50 border-yellow-200', countBg: 'bg-yellow-100 text-yellow-700' },
  red: { label: '🔴 Заморожены', action: 'PeerFlood активен — ничего не пишем, ждём 24ч', headerBg: 'bg-red-50 border-red-200', countBg: 'bg-red-100 text-red-600' },
  black: { label: '💀 Мёртвые', action: 'Сессия убита Telegram — нужна авторизация', headerBg: 'bg-gray-900 border-gray-700', countBg: 'bg-gray-700 text-gray-200' },
}

const TIER_BAR_COLOR: Record<Tier, string> = {
  purple: '#7C3AED', orange: '#EA580C', green: '#2D7D46', blue: '#3B82F6',
  yellow: '#D97706', red: '#DC2626', new: '#9CA3AF', black: '#6B7280',
}

const TIER_CARD_BG: Record<Tier, string> = {
  purple: 'bg-purple-50 border border-purple-200',
  orange: 'bg-orange-50 border border-orange-200',
  green: 'bg-green-50 border border-green-200',
  blue: 'bg-blue-50 border border-blue-200',
  yellow: 'bg-yellow-50 border border-yellow-200',
  red: 'bg-red-50 border border-red-200',
  new: 'bg-gray-50 border border-gray-200',
  black: 'bg-white border-2 border-gray-800',
}

function AccountCard({
  acc,
  sentByAccount,
  activity,
}: {
  acc: OutreachAccount
  sentByAccount: Map<string, { sent: number; replied: number }>
  activity: { session: string; type: string }[]
}) {
  const tier = getAccountTier(acc)
  const limit = acc.daily_limit || todayLimit(acc.session, tier)
  const pct = limit === 0 ? 0 : Math.min(100, Math.round(((acc.sent_today || 0) / limit) * 100))
  const remaining = Math.max(0, limit - (acc.sent_today || 0))
  const isPaused = tier === 'black' || tier === 'new' || acc.status === 'disconnected' || acc.status === 'auth_error'
  const lifetime = sentByAccount.get(acc.session) ?? { sent: 0, replied: 0 }
  const rate = lifetime.sent > 0 ? Math.round((lifetime.replied / lifetime.sent) * 100) : null
  const rec = recommendation(acc, { sent: lifetime.sent, rate })
  const barColor = TIER_BAR_COLOR[tier]
  const actCount = (type: string) => activity.filter((a) => a.session === acc.session && a.type === type).length

  return (
    <div className={`flex flex-col gap-2.5 rounded-2xl p-4 ${TIER_CARD_BG[tier]}`}>
      <div className="flex items-center gap-2">
        {acc.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={acc.avatar_url} alt="" className={`h-9 w-9 shrink-0 rounded-full object-cover ${tier === 'black' ? 'opacity-50 grayscale' : ''}`} />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8E0D5] text-sm font-semibold text-[#666]">
            {(acc.name ?? 'A')[0]}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1A1A1A]">{acc.name ?? sessionToName(acc.session)}</div>
          {acc.phone && <div className="text-xs text-[#AAA]">{acc.phone}</div>}
          <div className="text-xs text-[#999]">
            {ageDays(acc) !== null ? `День ${ageDays(acc)} · ` : ''}
            {acc.gender === 'female' ? '♀' : '♂'} · {limit === 0 ? 'не пишем' : `сегодня ${limit}`}
          </div>
        </div>
      </div>

      {isPaused ? (
        <div className={`rounded-xl px-3 py-2 text-center text-xs font-medium ${tier === 'black' ? 'bg-gray-700 text-gray-200' : tier === 'new' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-600'}`}>
          {acc.status === 'disconnected' ? '⚡ Сессия протухла — нужен QR' : acc.status === 'auth_error' ? '⚡ Auth key отозван — нужен QR' : tier === 'black' ? '💀 Сессия убита Telegram' : '⏳ День 1 — полная отлёжка'}
        </div>
      ) : (
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-[#888]">Отправлено: <b className="text-[#1A1A1A]">{acc.sent_today ?? 0}</b> / {limit}</span>
            {remaining > 0 ? <span className="font-semibold" style={{ color: barColor }}>+{remaining} план</span> : <span className="text-[#888]">лимит выполнен</span>}
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#F0EDE8]">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
          </div>
        </div>
      )}

      <div className="flex gap-3 border-t border-[#F5F3F0] pt-2 text-xs">
        <span className="text-[#888]">Всего: <b className="text-[#1A1A1A]">{lifetime.sent}</b></span>
        {lifetime.sent > 0 && (
          <span className="text-[#888]">
            Ответов: <b className={rate !== null && rate >= 10 ? 'text-green-600' : 'text-[#444]'}>{lifetime.replied} {rate !== null ? `(${rate}%)` : ''}</b>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-[#999]">
        {[
          { icon: '📖', val: actCount('chat_read') },
          { icon: '❤️', val: actCount('reaction') },
          { icon: '💬', val: actCount('inter_message') },
        ].map(({ icon, val }) => (
          <span key={icon} className={val > 0 ? 'text-[#555]' : 'text-[#DDD]'}>{icon}{val}</span>
        ))}
        <span className="text-[#DDD]">сег. прогрев</span>
        {(acc.flood_count ?? 0) > 0 && (
          <span className="ml-auto rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-500">🚨 флуд ×{acc.flood_count}</span>
        )}
      </div>

      <div className={`rounded-lg px-2.5 py-1.5 text-xs font-medium leading-snug ${rec.color}`}>
        {rec.text}
      </div>
    </div>
  )
}

function ReplyBox({
  contactId,
  accountId,
  onSent,
  showSkip,
}: {
  contactId: number
  accountId: number | null
  onSent: () => void
  showSkip?: boolean
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'queued' | 'skipped' | 'error'>('idle')

  async function post(action: 'send' | 'skip') {
    if (!accountId || state === 'sending') return
    if (action === 'send' && !text.trim()) return
    setState('sending')
    const res = await fetch('/api/admin/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contactId, account_id: accountId, action, text: text.trim() }),
    })
    if (!res.ok) {
      setState('error')
      return
    }
    if (action === 'send') setText('')
    setState(action === 'send' ? 'queued' : 'skipped')
    onSent()
  }

  return (
    <div className="mt-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void post('send') }
        }}
        disabled={state === 'sending'}
        placeholder="Написать ответ от имени менеджера..."
        rows={2}
        className="w-full resize-none rounded-xl border border-[#E0DBD5] p-3 text-sm outline-none focus:border-[#4A7B9D] disabled:opacity-50"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => void post('send')}
          disabled={!accountId || !text.trim() || state === 'sending'}
          className="rounded-full bg-[#4A7B9D] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#3a6b8d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === 'sending' ? 'Отправляю...' : 'Отправить'}
        </button>
        {showSkip && (
          <button
            onClick={() => void post('skip')}
            disabled={!accountId || state === 'sending'}
            className="rounded-full border border-[#E0DBD5] px-3 py-1.5 text-xs text-[#666] transition-colors hover:bg-[#FAF8F5] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Пропустить
          </button>
        )}
        {state === 'queued' && <span className="text-xs text-green-600">✅ В очереди — уйдёт за секунды</span>}
        {state === 'skipped' && <span className="text-xs text-[#888]">Пропущено</span>}
        {state === 'error' && <span className="text-xs text-red-600">Ошибка, попробуй ещё раз</span>}
        {!accountId && <span className="text-xs text-[#AAA]">Нет привязанного менеджера — отправка недоступна</span>}
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
  const [seenAt, setSeenAt] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('kitaiservice_outreach_seen') ?? '{}') } catch { return {} }
  })

  async function refresh() {
    setRefreshing(true)
    const res = await fetch('/api/admin/outreach', { cache: 'no-store' })
    if (res.ok) setData(await res.json())
    setRefreshing(false)
  }

  useEffect(() => {
    // Только подписка на внешний источник по таймеру — начальные данные уже пришли с сервера.
    const interval = setInterval(() => { void refresh() }, 20_000)
    return () => clearInterval(interval)
  }, [])

  const { accounts, contacts, activity, messages, synced_at, stats } = data

  // c.status — это ТЕКУЩЕЕ состояние обработки (может стать 'skipped' и после реального
  // ответа, если оператор потом пропустил диалог), а не флаг "отвечал ли человек когда-либо".
  // "Ответил" должен показывать всех, у кого есть хоть одно входящее сообщение, иначе те, кого
  // пропустили после ответа, тихо исчезают из вкладки и из приоритетной сортировки.
  const repliedContactIds = new Set(messages.filter((m) => m.direction === 'in').map((m) => m.contact_id))

  function markSeen(contactId: number) {
    const now = new Date().toISOString()
    setSeenAt((prev) => {
      const next = { ...prev, [contactId]: now }
      try { localStorage.setItem('kitaiservice_outreach_seen', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Непрочитанным считаем контакт, у которого последнее входящее сообщение свежее
  // и чем последний исходящий ответ менеджера, и чем момент, когда оператор
  // последний раз открывал этот диалог (см. seenAt / markSeen).
  function hasUnread(contactId: number) {
    const contactMsgs = messages.filter((m) => m.contact_id === contactId)
    const inMsgs = contactMsgs.filter((m) => m.direction === 'in')
    if (!inMsgs.length) return false
    const latestIn = inMsgs.map((m) => m.sent_at ?? '').sort().at(-1) ?? ''
    const outMsgs = contactMsgs.filter((m) => m.direction === 'out')
    const latestOut = outMsgs.map((m) => m.sent_at ?? '').sort().at(-1) ?? ''
    if (latestOut && latestOut > latestIn) return false
    const lastSeen = seenAt[contactId]
    return !lastSeen || latestIn > lastSeen
  }

  const sentByAccount = new Map<string, { sent: number; replied: number }>()
  for (const c of contacts) {
    if (!c.account_session) continue
    const cur = sentByAccount.get(c.account_session) ?? { sent: 0, replied: 0 }
    if (c.status === 'sent' || repliedContactIds.has(c.id)) cur.sent += 1
    if (repliedContactIds.has(c.id)) cur.replied += 1
    sentByAccount.set(c.account_session, cur)
  }

  const tiers = (['purple', 'orange', 'green', 'blue', 'new', 'yellow', 'red', 'black'] as Tier[]).map((key) => ({
    key,
    accs: accounts.filter((a) => (key === 'black' ? a.status === 'dead' : getAccountTier(a) === key)),
  }))

  const filteredContactsBase = contacts.filter((c) => {
    if (statusFilter === 'replied') {
      if (!repliedContactIds.has(c.id)) return false
    } else if (statusFilter !== 'all' && c.status !== statusFilter) {
      return false
    }
    if (search) {
      const q = search.toLowerCase()
      return (c.username ?? '').toLowerCase().includes(q) || c.tg_id.includes(q)
    }
    return true
  })
  // При "все" — ответившие всегда наверху, среди них сначала "дожать", потом интерес,
  // потом неясно, потом отказ; иначе — как отфильтровано, без пересортировки.
  const filteredContacts = statusFilter === 'all'
    ? [...filteredContactsBase].sort((a, b) => {
        const priority = (c: OutreachContact) => (repliedContactIds.has(c.id) ? 0 : c.status === 'sent' ? 1 : 2)
        const pd = priority(a) - priority(b)
        if (pd !== 0) return pd
        const sentPriority = (s: string | null) => (s === 'warm' ? 0 : s === 'green' ? 1 : s === 'gray' ? 2 : s === 'red' ? 3 : 4)
        const sd = sentPriority(a.sentiment) - sentPriority(b.sentiment)
        if (sd !== 0) return sd
        return (b.replied_at ?? b.sent_at ?? '').localeCompare(a.replied_at ?? a.sent_at ?? '')
      })
    : filteredContactsBase

  const proxyEvents = activity.filter((a) => a.type === 'proxy_down' || a.type === 'proxy_up').sort((a, b) => b.done_at.localeCompare(a.done_at))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#888]">Синк: {fmt(synced_at)}{refreshing && ' · обновляю...'}</p>
        <button onClick={() => void refresh()} className="rounded-xl border border-[#E0DBD5] px-3 py-1.5 text-xs text-[#666] hover:bg-[#FAF8F5]">
          Обновить
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#888]">Сегодня</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Отправлено', value: stats.sent_today, color: '#4A7B9D' },
            { label: 'Ответили', value: stats.replied_today, color: '#2D7D46' },
            { label: 'Конверсия', value: `${stats.conversion_today}%`, color: '#7B5EA7' },
            { label: 'Сообщений', value: stats.messages_today, color: '#1A1A1A' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white p-4">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="mt-1 text-xs text-[#888]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#888]">Всего</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            { label: 'В базе', value: contacts.length, color: '#1A1A1A' },
            { label: 'Новых', value: stats.new_all, color: '#888' },
            { label: 'Отправлено', value: stats.sent_all, color: '#4A7B9D' },
            { label: 'Ответили', value: stats.replied_all, color: '#2D7D46' },
            { label: 'Конверсия', value: stats.sent_all > 0 ? `${Math.round((stats.replied_all / stats.sent_all) * 100)}%` : '0%', color: '#7B5EA7' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white p-4">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="mt-1 text-xs text-[#888]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-[#555]">Аккаунты</h2>
        {accounts.length === 0 && <p className="text-sm text-[#999]">Нет аккаунтов — bots/outreach ещё не подключён к KitaiService.</p>}
        {tiers.map((t) => {
          if (t.accs.length === 0) return null
          const meta = TIER_META[t.key]
          return (
            <div key={t.key}>
              <div className={`mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 ${meta.headerBg}`}>
                <span className={`text-sm font-bold ${t.key === 'black' ? 'text-white' : 'text-[#1A1A1A]'}`}>{meta.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${meta.countBg}`}>{t.accs.length} акк.</span>
                <span className={`ml-auto text-xs ${t.key === 'black' ? 'text-gray-300' : 'text-[#999]'}`}>{meta.action}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {t.accs.map((acc) => <AccountCard key={acc.id} acc={acc} sentByAccount={sentByAccount} activity={activity} />)}
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[#555]">🔌 Прокси сегодня</h2>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {proxyEvents.length === 0 ? (
            <div className="px-4 py-3 text-xs font-medium text-green-600">✅ Все прокси работают штатно (или нет данных синка)</div>
          ) : (
            proxyEvents.map((e, i) => {
              const acc = accounts.find((a) => a.session === e.session)
              const name = acc?.name ?? e.session.replace('manager_', '')
              const isDown = e.type === 'proxy_down'
              return (
                <div key={i} className={`flex items-center gap-3 border-b border-[#F8F6F3] px-4 py-2.5 text-xs last:border-0 ${isDown ? 'bg-red-50' : 'bg-green-50'}`}>
                  <span>{isDown ? '🔴' : '🟢'}</span>
                  <span className="w-24 shrink-0 font-medium text-[#1A1A1A]">{name}</span>
                  <span className="flex-1 text-[#555]">{e.detail}</span>
                  <span className="whitespace-nowrap text-[#AAA]">{new Date(e.done_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-[#555]">Контакты</h2>
          <div className="flex flex-wrap gap-1.5">
            {['all', 'new', 'sent', 'replied', 'skipped', 'failed'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-all ${statusFilter === s ? 'border-transparent bg-[#1A1A1A] text-white' : 'border-[#E0DBD5] text-[#666]'}`}
              >
                {s === 'all' ? 'Все' : STATUS_RU[s]}
              </button>
            ))}
          </div>
          <input
            placeholder="Поиск @username или ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ml-auto w-52 rounded-xl border border-[#E0DBD5] px-3 py-1.5 text-xs outline-none"
          />
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#F0EBE5]">
                  {['Username', 'Статус', 'Сообщение клиента', 'Менеджер', 'Отправлено', 'Ответил'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-xs font-medium text-[#999]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredContacts.slice(0, 300).map((c) => {
                  const contactMsgs = messages.filter((m) => m.contact_id === c.id).sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
                  const lastInMsg = [...contactMsgs].reverse().find((m) => m.direction === 'in') ?? null
                  const manager = accounts.find((a) => a.session === c.account_session) ?? null
                  const isSelected = selectedId === c.id
                  const unread = repliedContactIds.has(c.id) && hasUnread(c.id)
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => {
                          if (isSelected) {
                            setSelectedId(null)
                          } else {
                            setSelectedId(c.id)
                            markSeen(c.id)
                          }
                        }}
                        className={`cursor-pointer border-t border-[#F8F6F3] transition-colors ${isSelected ? 'bg-[#F5F0EB]' : 'hover:bg-[#FAF8F5]'}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />}
                            <span className="font-medium text-[#1A1A1A]">{c.username ? `@${c.username}` : c.tg_id}</span>
                            <a
                              href={c.username ? `https://t.me/${c.username}` : `tg://user?id=${c.tg_id}`}
                              target="_blank" rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="whitespace-nowrap rounded-lg border border-[#D0E4F0] px-2 py-0.5 text-xs text-[#4A7B9D] hover:bg-[#EBF4FA] transition-colors"
                            >
                              ✍️ Написать
                            </a>
                          </div>
                          <div className="text-xs text-[#BBB]">{c.tg_id}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          {repliedContactIds.has(c.id) && lastInMsg ? (
                            <span
                              title={c.sentiment_reason ?? undefined}
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                c.sentiment === 'green' ? 'bg-green-100 text-green-700'
                                : c.sentiment === 'warm' ? 'bg-orange-100 text-orange-700'
                                : c.sentiment === 'red' ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {c.sentiment === 'green' ? '✅ Интерес'
                                : c.sentiment === 'warm' ? '🔥 Дожать'
                                : c.sentiment === 'red' ? '❌ Отказ'
                                : c.sentiment === 'gray' ? '🤷 Неясно'
                                : '💬 Ответил (оценка...)'}
                            </span>
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_RU[c.status] ?? c.status}</span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-2.5">
                          {lastInMsg ? (
                            <div className={`max-w-[200px] truncate text-xs leading-relaxed ${unread ? 'font-semibold text-[#1A1A1A]' : 'text-[#666]'}`}>{lastInMsg.text}</div>
                          ) : (
                            <span className="text-xs text-[#CCC]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {manager ? (
                            <div className="flex items-center gap-1.5">
                              {manager.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={manager.avatar_url} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                              ) : (
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#E8E0D5] text-[10px] font-semibold text-[#666]">
                                  {(manager.name ?? 'A')[0]}
                                </div>
                              )}
                              <div>
                                <div className="text-xs font-medium text-[#1A1A1A]">{manager.name ?? sessionToName(manager.session)}</div>
                                {manager.phone && <div className="text-xs text-[#999]">{manager.phone}</div>}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-[#CCC]">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#888]">{fmt(c.sent_at)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#888]">{fmt(c.replied_at)}</td>
                      </tr>
                      {isSelected && (
                        <tr key={`${c.id}-chat`} className="bg-[#F5F0EB]">
                          <td colSpan={6} className="px-6 py-4">
                            {contactMsgs.length === 0 ? (
                              <div className="text-xs text-[#999]">Сообщений нет</div>
                            ) : (
                              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                                {contactMsgs.map((m) => (
                                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.direction === 'out' ? 'bg-[#1A1A1A] text-white' : 'border border-[#E8E4DF] bg-white text-[#1A1A1A]'}`}>
                                      <div className="whitespace-pre-wrap">{m.text}</div>
                                      <div className={`mt-1 text-[10px] ${m.direction === 'out' ? 'text-[#888]' : 'text-[#BBB]'}`}>{m.sent_at ? new Date(m.sent_at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <ReplyBox
                              contactId={c.id}
                              accountId={c.account_id}
                              onSent={() => void refresh()}
                              showSkip
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {filteredContacts.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-[#999]">Нет контактов</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredContacts.length > 300 && (
            <div className="border-t border-[#F0EBE5] px-4 py-3 text-xs text-[#888]">Показано 300 из {filteredContacts.length} — уточните фильтр</div>
          )}
        </div>
      </div>
    </div>
  )
}
