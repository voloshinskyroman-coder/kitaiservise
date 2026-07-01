'use client'

import { useEffect, useState } from 'react'

// ── Outreach types ────────────────────────────────────────────────────────────

type OutreachAccount = {
  id: number
  session: string
  phone: string | null
  gender: string | null
  status: string
  daily_limit: number
  paused_until: string | null
  flood_count: number | null
  sent_today: number
  synced_at: string | null
  created_at: string | null
  name: string | null
  avatar_url: string | null
}

type OutreachContact = {
  id: number
  tg_id: string
  username: string | null
  status: string
  account_id: number | null
  account_session: string | null
  imported_at: string | null
  sent_at: string | null
  replied_at: string | null
}

type OutreachConversation = {
  id: number
  contact_id: number
  account_id: number | null
  status: string
  ai_draft: string | null
  created_at: string | null
  updated_at: string | null
  outreach_contacts: { username: string | null; tg_id: string } | null
}

type OutreachMessage = {
  id: number
  contact_id: number
  direction: string
  text: string | null
  sent_at: string | null
}

// ── Reply classifier ─────────────────────────────────────────────────────────

const POSITIVE_KW = [
  "интересно", "интересует", "актуально", "актуален", "актуальна",
  "хочу", "хотим", "сколько стоит", "сколько", "цена", "прайс",
  "подробнее", "расскажите", "скажите", "можно", "хотелось бы",
  "планируем", "планирую", "думаем", "договорились", "запишите", "звоните", "пишите",
]
const NEGATIVE_KW = [
  "не интересно", "не актуально", "не актуален", "неактуально", "неактуален",
  "не надо", "не нужно", "не требуется",
  "уже есть", "не беспокойте", "отпишите", "спам",
  "нет спасибо", "не хочу", "не буду", "не планируем", "не планирую",
]

function classifyReply(text: string | null): 'green' | 'red' | 'gray' {
  if (!text) return 'gray'
  const t = text.toLowerCase()
  if (NEGATIVE_KW.some(kw => t.includes(kw))) return 'red'
  if (POSITIVE_KW.some(kw => t.includes(kw))) return 'green'
  return 'gray'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  new:     'bg-gray-100 text-gray-500',
  sent:    'bg-blue-100 text-blue-700',
  replied: 'bg-green-100 text-green-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  failed:  'bg-red-100 text-red-700',
}
const STATUS_RU: Record<string, string> = {
  new: 'Новый', sent: 'Отправлено', replied: 'Ответил',
  skipped: 'Пропущен', failed: 'Ошибка',
}

function fmt(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
function sessionToName(session: string) {
  return session.replace('manager_', '+').replace('account_', '+')
}

type Tier = 'purple' | 'orange' | 'green' | 'blue' | 'yellow' | 'red' | 'new' | 'black'

const TIER_CAP: Record<Tier, number> = {
  purple: 10, orange: 8, green: 6, blue: 4, yellow: 1, red: 0, new: 0, black: 0,
}
const TIER_RANGE: Record<Tier, [number, number]> = {
  purple: [8, 10], orange: [6, 8], green: [4, 6], blue: [2, 4],
  yellow: [0, 1], red: [0, 0], new: [0, 0], black: [0, 0],
}

function todayLimit(session: string, tier: Tier): number {
  const [lo, hi] = TIER_RANGE[tier]
  if (lo === hi) return lo
  const today = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''))
  let h = 0
  for (let i = 0; i < session.length; i++) h = Math.imul(31, h) + session.charCodeAt(i) | 0
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
  if (ageDays <= 1)  return 'new'
  if (ageDays <= 6)  return 'blue'
  if (ageDays <= 13) return 'green'
  if (ageDays <= 20) return 'orange'
  return 'purple'
}

function pauseCountdown(paused_until: string | null): string {
  if (!paused_until) return ''
  const diff = new Date(paused_until).getTime() - Date.now()
  if (diff <= 0) return 'скоро'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 24) return `~${Math.ceil(h / 24)} дн.`
  return `${h}ч ${m}м`
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (pwd: string) => void }) {
  const [pwd, setPwd] = useState('')
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]">
      <form onSubmit={e => { e.preventDefault(); onLogin(pwd) }}
        className="bg-white rounded-2xl p-8 shadow-sm w-80">
        <h1 className="text-xl font-bold mb-6 text-[#1A1A1A]">Kitai Servise — Admin</h1>
        <input type="password" placeholder="Пароль" value={pwd}
          onChange={e => setPwd(e.target.value)} autoFocus
          className="w-full border border-[#E0E8F0] rounded-xl px-4 py-3 mb-4 text-sm outline-none" />
        <button type="submit"
          className="w-full bg-[#1A1A1A] text-white rounded-xl py-3 text-sm font-medium">
          Войти
        </button>
      </form>
    </div>
  )
}

// ── Outreach tab ──────────────────────────────────────────────────────────────

type ActivityEntry = { session: string; type: string; detail: string; done_at: string }

type OutreachStats = {
  messages_today: number
  sent_today: number
  replied_today: number
  conversion_today: number
  replied_all: number
  sent_all: number
  new_all: number
}

function OutreachTab({ pwd }: { pwd: string }) {
  const [data, setData] = useState<{
    accounts: OutreachAccount[]
    contacts: OutreachContact[]
    conversations: OutreachConversation[]
    activity: ActivityEntry[]
    messages: OutreachMessage[]
    synced_at: string | null
    stats: OutreachStats
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [seenAt, setSeenAt] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem('kitai_seen') ?? '{}') } catch { return {} }
  })

  async function load(silent = false) {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const res = await fetch('/api/admin/outreach', {
      headers: { 'x-admin-secret': pwd },
      cache: 'no-store',
    })
    if (res.ok) {
      setData(await res.json())
      setLastUpdated(new Date())
    }
    if (!silent) setLoading(false)
    else setRefreshing(false)
  }

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), 60_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="text-center py-24 text-[#888]">Загрузка...</div>
  if (!data) return <div className="text-center py-24 text-[#888]">Ошибка загрузки</div>

  const { accounts, contacts, conversations, activity, messages, synced_at, stats } = data

  function markSeen(contactId: number) {
    const now = new Date().toISOString()
    const next = { ...seenAt, [contactId]: now }
    setSeenAt(next)
    try { localStorage.setItem('kitai_seen', JSON.stringify(next)) } catch {}
  }

  function hasUnread(contactId: number) {
    const lastSeen = seenAt[contactId]
    const contactMsgs = messages.filter(m => m.contact_id === contactId && m.direction === 'in')
    if (!contactMsgs.length) return false
    const latest = contactMsgs.map(m => m.sent_at ?? '').sort().at(-1) ?? ''
    return !lastSeen || latest > lastSeen
  }

  function actCount(session: string, type: string) {
    return activity.filter(a => a.session === session && a.type === type).length
  }

  const totalContacts = contacts.length
  const sentCount     = contacts.filter(c => ['sent','replied'].includes(c.status)).length
  const repliedCount  = contacts.filter(c => c.status === 'replied').length

  const filtered = contacts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (c.username ?? '').toLowerCase().includes(q) || c.tg_id.includes(q)
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#999]">
          Синк: {synced_at ? fmt(synced_at) : '—'} ·{' '}
          {lastUpdated ? `обновлено ${lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          {refreshing && ' · обновляю...'}
        </p>
        <button onClick={() => load()} className="text-xs text-[#666] border border-[#E0E8F0] rounded-xl px-3 py-1.5">
          Обновить
        </button>
      </div>

      {/* Сегодня */}
      <div>
        <p className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-2">Сегодня</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Отправлено',  value: stats.sent_today,      color: '#4A7B9D' },
            { label: 'Ответили',    value: stats.replied_today,   color: '#2D7D46' },
            { label: 'Конверсия',   value: `${stats.conversion_today}%`, color: '#7B5EA7' },
            { label: 'Сообщений',   value: stats.messages_today,  color: '#1A1A1A' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-4">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-[#888] mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Всего */}
      <div>
        <p className="text-xs font-semibold text-[#888] uppercase tracking-wider mb-2">Всего</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'В базе',       value: totalContacts,   color: '#1A1A1A', key: 'all' },
            { label: 'Новых',        value: stats.new_all,   color: '#888',    key: 'new' },
            { label: 'Отправлено',   value: stats.sent_all,  color: '#4A7B9D', key: 'sent' },
            { label: 'Ответили',     value: stats.replied_all, color: '#2D7D46', key: 'replied' },
            { label: 'Конверсия',    value: stats.sent_all > 0 ? `${Math.round(stats.replied_all / stats.sent_all * 100)}%` : '0%', color: '#7B5EA7', key: null },
          ].map(s => (
            <button key={s.label}
              onClick={() => s.key && setStatusFilter(s.key)}
              className={`bg-white rounded-2xl p-4 text-left transition-all ${statusFilter === s.key ? 'ring-2 ring-[#1A1A1A]' : ''}`}>
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-[#888] mt-1">{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Accounts */}
      {(() => {
        const now = new Date()

        function accStats(session: string) {
          const mine    = contacts.filter(c => c.account_session === session)
          const sent    = mine.filter(c => ['sent', 'replied'].includes(c.status)).length
          const replied = mine.filter(c => c.status === 'replied').length
          return { sent, replied, rate: sent > 0 ? Math.round((replied / sent) * 100) : null }
        }

        function ageDays(acc: OutreachAccount): number | null {
          if (!acc.created_at) return null
          const c = new Date(acc.created_at)
          const dayCreated = new Date(c.getFullYear(), c.getMonth(), c.getDate())
          const dayNow     = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          return Math.floor((dayNow.getTime() - dayCreated.getTime()) / 86_400_000) + 1
        }

        function recommendation(acc: OutreachAccount, stats: { sent: number; rate: number | null }) {
          const tier = getAccountTier(acc)
          if (acc.status === 'disconnected') return { text: 'Сессия протухла — нужна переавторизация через QR', color: 'text-orange-700 bg-orange-50' }
          if (acc.status === 'auth_error')   return { text: 'Auth key отозван — нужна переавторизация через QR', color: 'text-orange-700 bg-orange-50' }
          if (tier === 'black')  return { text: 'Сессия убита — нужна авторизация', color: 'text-gray-300 bg-gray-800' }
          if (tier === 'new')    return { text: 'Новый аккаунт — дни 1-2, полная тишина', color: 'text-gray-500 bg-gray-50' }
          if (tier === 'red')    return { text: `Заморожен — ждём 24ч. Выйдет ${acc.paused_until ? fmt(acc.paused_until) : ''}`, color: 'text-red-600 bg-red-50' }
          if (tier === 'yellow') return { text: 'Предупреждение было < 24ч назад — макс 2/день', color: 'text-yellow-800 bg-yellow-50' }
          if (tier === 'blue')   return { text: `День ${ageDays(acc) ?? 2} — прогрев, не более 3 сообщений/день`, color: 'text-blue-700 bg-blue-50' }
          if (tier === 'green')  return { text: `День ${ageDays(acc) ?? 8} — нарабатываем историю, до 5/день`, color: 'text-green-700 bg-green-50' }
          if (tier === 'orange') return { text: `День ${ageDays(acc) ?? 15} — ускоряемся, до 7/день`, color: 'text-orange-700 bg-orange-50' }
          if (stats.sent >= 40)  return { text: `День ${ageDays(acc) ?? 22} — топ: ${stats.sent} DM, конверсия ${stats.rate ?? 0}%`, color: 'text-purple-700 bg-purple-50' }
          return { text: `День ${ageDays(acc) ?? 22} — грузим по максимуму, до 10/день`, color: 'text-purple-700 bg-purple-50' }
        }

        function AccCard({ acc }: { acc: OutreachAccount }) {
          const tier      = getAccountTier(acc)
          const stats     = accStats(acc.session)
          const limit     = acc.daily_limit || todayLimit(acc.session, tier)
          const pct       = limit === 0 ? 0 : Math.min(100, Math.round(((acc.sent_today || 0) / limit) * 100))
          const remaining = Math.max(0, limit - (acc.sent_today || 0))
          const isPaused  = tier === 'black' || tier === 'new' || acc.status === 'disconnected' || acc.status === 'auth_error'
          const rec       = recommendation(acc, stats)
          const barColor  = tier === 'purple' ? '#7C3AED' : tier === 'orange' ? '#EA580C' : tier === 'green' ? '#2D7D46' : tier === 'blue' ? '#3B82F6' : tier === 'yellow' ? '#D97706' : tier === 'red' ? '#DC2626' : '#9CA3AF'
          const cardBg    = tier === 'purple' ? 'bg-purple-50 border border-purple-200' : tier === 'orange' ? 'bg-orange-50 border border-orange-200' : tier === 'green' ? 'bg-green-50 border border-green-200' : tier === 'blue' ? 'bg-blue-50 border border-blue-200' : tier === 'yellow' ? 'bg-yellow-50 border border-yellow-200' : tier === 'red' ? 'bg-red-50 border border-red-200' : tier === 'new' ? 'bg-gray-50 border border-gray-200' : 'bg-white border-2 border-gray-800'

          return (
            <div className={`${cardBg} rounded-2xl p-4 flex flex-col gap-2.5`}>
              <div className="flex items-center gap-2">
                {acc.avatar_url
                  ? <img src={acc.avatar_url} alt="" className={`w-9 h-9 rounded-full object-cover shrink-0 ${tier === 'black' ? 'grayscale opacity-50' : ''}`} />
                  : <div className="w-9 h-9 rounded-full bg-[#E0E8F0] flex items-center justify-center text-sm font-semibold text-[#666] shrink-0">{(acc.name ?? 'A')[0]}</div>
                }
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate text-[#1A1A1A]">{acc.name ?? sessionToName(acc.session)}</div>
                  {acc.phone && <div className="text-xs text-[#AAA]">{acc.phone}</div>}
                  <div className="text-xs text-[#999]">{ageDays(acc) !== null ? `День ${ageDays(acc)} · ` : ''}{acc.gender === 'female' ? '♀' : '♂'} · {limit === 0 ? 'не пишем' : `сегодня ${limit}`}</div>
                </div>
              </div>
              {isPaused ? (
                <div className={`rounded-xl px-3 py-2 text-xs font-medium text-center ${tier === 'black' ? 'bg-gray-700 text-gray-200' : tier === 'new' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-600'}`}>
                  {acc.status === 'disconnected' ? '⚡ Сессия протухла — нужен QR' : acc.status === 'auth_error' ? '⚡ Auth key отозван — нужен QR' : tier === 'black' ? '💀 Сессия убита Telegram' : '⏳ День 1 — полная отлёжка'}
                </div>
              ) : (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#888]">Отправлено: <b className="text-[#1A1A1A]">{acc.sent_today ?? 0}</b> / {limit}</span>
                    {remaining > 0 ? <span className="font-semibold" style={{ color: barColor }}>+{remaining} план</span> : <span className="text-[#888]">лимит выполнен</span>}
                  </div>
                  <div className="w-full bg-[#EFF4F8] rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                  </div>
                </div>
              )}
              <div className="flex gap-3 text-xs border-t border-[#EFF4F8] pt-2">
                <span className="text-[#888]">Всего: <b className="text-[#1A1A1A]">{stats.sent}</b></span>
                {stats.sent > 0 && <span className="text-[#888]">Ответов: <b className={stats.rate !== null && stats.rate >= 10 ? 'text-green-600' : 'text-[#444]'}>{stats.replied} {stats.rate !== null ? `(${stats.rate}%)` : ''}</b></span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-[#999]">
                {[
                  { icon: '📖', val: actCount(acc.session, 'chat_read') },
                  { icon: '❤️', val: actCount(acc.session, 'reaction') },
                  { icon: '💬', val: actCount(acc.session, 'inter_message') },
                ].map(({ icon, val }) => (
                  <span key={icon} className={val > 0 ? 'text-[#555]' : 'text-[#DDD]'}>{icon}{val}</span>
                ))}
                <span className="text-[#DDD]">сег. прогрев</span>
                {(acc.flood_count ?? 0) > 0 && <span className="ml-auto text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">🚨 флуд ×{acc.flood_count}</span>}
              </div>
              <div className={`text-xs font-medium px-2.5 py-1.5 rounded-lg leading-snug ${rec.color}`}>{rec.text}</div>
            </div>
          )
        }

        function tierAggregate(accs: OutreachAccount[]) {
          return accs.reduce((s, a) => {
            const st = accStats(a.session)
            return { sent: s.sent + st.sent, replied: s.replied + st.replied }
          }, { sent: 0, replied: 0 })
        }

        const tiers = [
          { key: 'purple', label: '🟣 Топ-аккаунты', accs: accounts.filter(a => getAccountTier(a) === 'purple'), action: 'День 22+ — до 10/день', headerBg: 'bg-purple-50 border-purple-200', countBg: 'bg-purple-100 text-purple-700' },
          { key: 'orange', label: '🟠 Ускоряемся',   accs: accounts.filter(a => getAccountTier(a) === 'orange'), action: 'Дни 15-21 — до 7/день', headerBg: 'bg-orange-50 border-orange-200', countBg: 'bg-orange-100 text-orange-700' },
          { key: 'green',  label: '🟢 Нарабатываем', accs: accounts.filter(a => getAccountTier(a) === 'green'),  action: 'Дни 8-14 — до 5/день',  headerBg: 'bg-green-50 border-green-200',  countBg: 'bg-green-100 text-green-700' },
          { key: 'blue',   label: '🔵 Прогрев',      accs: accounts.filter(a => getAccountTier(a) === 'blue'),   action: 'Дни 3-7 — до 3/день',   headerBg: 'bg-blue-50 border-blue-200',   countBg: 'bg-blue-100 text-blue-700' },
          { key: 'new',    label: '⚪ Дни 1-2',      accs: accounts.filter(a => getAccountTier(a) === 'new'),    action: 'Полная тишина',          headerBg: 'bg-gray-50 border-gray-200',   countBg: 'bg-gray-100 text-gray-600' },
          { key: 'yellow', label: '🟡 Предупреждение', accs: accounts.filter(a => getAccountTier(a) === 'yellow'), action: 'PeerFlood < 24ч — макс 2/день', headerBg: 'bg-yellow-50 border-yellow-200', countBg: 'bg-yellow-100 text-yellow-700' },
          { key: 'red',    label: '🔴 Заморожены',   accs: accounts.filter(a => getAccountTier(a) === 'red'),    action: 'PeerFlood — ждём 24ч',  headerBg: 'bg-red-50 border-red-200',     countBg: 'bg-red-100 text-red-600' },
          { key: 'black',  label: '💀 Мёртвые',      accs: accounts.filter(a => a.status === 'dead'),            action: 'Нужна авторизация',      headerBg: 'bg-gray-900 border-gray-700',  countBg: 'bg-gray-700 text-gray-200' },
          { key: 'disconnected', label: '⚡ Отвалились', accs: accounts.filter(a => a.status === 'disconnected' || a.status === 'auth_error'), action: 'Нужна переавторизация QR', headerBg: 'bg-red-50 border-red-300', countBg: 'bg-red-100 text-red-700' },
        ]

        const activeAccounts = accounts.filter(a => ['purple','orange','green','blue','yellow'].includes(getAccountTier(a)))
        const totalSent     = accounts.reduce((s, a) => s + (a.sent_today || 0), 0)
        const totalCapacity = activeAccounts.reduce((s, a) => s + (a.daily_limit || todayLimit(a.session, getAccountTier(a))), 0)
        const totalPlan     = activeAccounts.reduce((s, a) => { const lim = a.daily_limit || todayLimit(a.session, getAccountTier(a)); return s + Math.max(0, lim - (a.sent_today || 0)) }, 0)

        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#555]">Аккаунты</h2>
              <div className="text-xs text-[#888]">
                План: <span className="font-semibold text-[#1A1A1A]">{totalCapacity}</span>
                · Отправлено: <span className="font-semibold text-[#4A7B9D]">{totalSent}</span>
                · Осталось: <span className="font-semibold text-[#2D7D46]">{totalPlan}</span>
              </div>
            </div>
            {tiers.map(tier => {
              if (tier.accs.length === 0) return null
              const agg = tierAggregate(tier.accs)
              const aggRate = agg.sent > 0 ? ((agg.replied / agg.sent) * 100).toFixed(1) : null
              return (
                <div key={tier.key}>
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border rounded-xl px-4 py-2.5 mb-3 ${tier.headerBg}`}>
                    <span className={`font-bold text-sm ${tier.key === 'black' ? 'text-white' : 'text-[#1A1A1A]'}`}>{tier.label}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tier.countBg}`}>{tier.accs.length} акк.</span>
                    {agg.sent > 0 && <span className="text-xs text-[#666]">Всего {agg.sent} DM · {agg.replied} ответов{aggRate ? ` (${aggRate}%)` : ''}</span>}
                    <span className={`text-xs ml-auto ${tier.key === 'black' ? 'text-gray-300' : 'text-[#999]'}`}>{tier.action}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    {tier.accs.map(acc => <AccCard key={acc.id} acc={acc} />)}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Прокси */}
      {(() => {
        const proxyEvents = activity.filter(a => a.type === 'proxy_down' || a.type === 'proxy_up').sort((a, b) => b.done_at.localeCompare(a.done_at))
        return (
          <div>
            <h2 className="text-sm font-semibold text-[#555] mb-3">🔌 Прокси сегодня</h2>
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              {proxyEvents.length === 0 ? (
                <div className="px-4 py-3 text-xs text-green-600 font-medium">✅ Все прокси работают штатно</div>
              ) : proxyEvents.map((e, i) => {
                const acc = accounts.find(a => a.session === e.session)
                const name = acc?.name ?? e.session.replace('manager_', '')
                const isDown = e.type === 'proxy_down'
                return (
                  <div key={i} className={`flex items-center gap-3 px-4 py-2.5 text-xs border-b border-[#F8F6F3] last:border-0 ${isDown ? 'bg-red-50' : 'bg-green-50'}`}>
                    <span>{isDown ? '🔴' : '🟢'}</span>
                    <span className="font-medium text-[#1A1A1A] w-24 shrink-0">{name}</span>
                    <span className="text-[#555] flex-1">{e.detail}</span>
                    <span className="text-[#AAA] whitespace-nowrap">{new Date(e.done_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Открытые диалоги */}
      {conversations.filter(c => c.status === 'open').length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#555] mb-3">Открытые диалоги ({conversations.filter(c => c.status === 'open').length})</h2>
          <div className="space-y-2">
            {conversations.filter(c => c.status === 'open').map(conv => {
              const clientMsgs = messages.filter(m => m.contact_id === conv.contact_id && m.direction === 'in').sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
              const manager = accounts.find(a => a.id === conv.account_id) ?? null
              return (
                <div key={conv.id} className="bg-white rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-sm text-[#1A1A1A]">@{conv.outreach_contacts?.username ?? conv.contact_id}</div>
                      <div className="text-xs text-[#888] mt-0.5">{fmt(conv.updated_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {conv.outreach_contacts?.username && (
                        <a href={`https://t.me/${conv.outreach_contacts.username}`} target="_blank" rel="noreferrer"
                          className="text-xs bg-[#4A7B9D] text-white px-3 py-1 rounded-full hover:bg-[#3a6b8d] transition-colors">
                          ✍️ Написать
                        </a>
                      )}
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">открыт</span>
                    </div>
                  </div>
                  {manager && (
                    <div className="flex items-center gap-2 mt-2 px-1">
                      {manager.avatar_url
                        ? <img src={manager.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                        : <div className="w-5 h-5 rounded-full bg-[#E0E8F0] flex items-center justify-center text-[10px] font-semibold text-[#666] shrink-0">{(manager.name ?? 'A')[0]}</div>
                      }
                      <span className="text-xs text-[#555]"><span className="font-medium">{manager.name ?? sessionToName(manager.session)}</span>{manager.phone && <span className="text-[#999] ml-1">{manager.phone}</span>}</span>
                    </div>
                  )}
                  {clientMsgs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-xs font-medium text-green-700">💬 Сообщения:</div>
                      {clientMsgs.map(msg => (
                        <div key={msg.id}>
                          <div className="text-sm text-[#1A1A1A] bg-green-50 border border-green-200 rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                          <div className="text-xs text-[#AAA] mt-0.5 ml-1">{fmt(msg.sent_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {conv.ai_draft && (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-[#888] mb-1">🤖 AI черновик:</div>
                      <div className="text-xs text-[#555] bg-[#F0F4F8] rounded-xl p-3 leading-relaxed whitespace-pre-wrap">{conv.ai_draft}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Контакты */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold text-[#555]">Контакты</h2>
          <div className="flex gap-1.5 flex-wrap">
            {['all','new','sent','replied','skipped','failed'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${statusFilter === s ? 'bg-[#1A1A1A] text-white border-transparent' : 'text-[#666] border-[#E0E8F0]'}`}>
                {STATUS_RU[s] ?? 'Все'}
              </button>
            ))}
          </div>
          <input placeholder="Поиск @username или ID" value={search} onChange={e => setSearch(e.target.value)}
            className="ml-auto text-xs border border-[#E0E8F0] rounded-xl px-3 py-1.5 outline-none w-52" />
        </div>
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F0EBE5] text-left">
                  {['Username', 'Статус', 'Сообщение', 'Менеджер', 'Отправлено', 'Ответил'].map(h => (
                    <th key={h} className="px-4 py-3 text-[#999] font-medium text-xs whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(statusFilter === 'all' ? [...filtered].sort((a, b) => {
                  const priority = (s: string) => s === 'replied' ? 0 : s === 'sent' ? 1 : 2
                  const pd = priority(a.status) - priority(b.status)
                  if (pd !== 0) return pd
                  return (b.replied_at ?? b.sent_at ?? '').localeCompare(a.replied_at ?? a.sent_at ?? '')
                }).slice(0, 300) : filtered.slice(0, 300)).map(c => {
                  const contactMsgs = messages.filter(m => m.contact_id === c.id).sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
                  const lastInMsg = [...contactMsgs].reverse().find(m => m.direction === 'in') ?? null
                  const manager = accounts.find(a => a.session === c.account_session) ?? null
                  const isSelected = selectedId === c.id
                  const unread = c.status === 'replied' && hasUnread(c.id)
                  return (
                    <>
                    <tr key={c.id} onClick={() => { if (isSelected) { setSelectedId(null) } else { setSelectedId(c.id); markSeen(c.id) } }}
                      className={`border-b border-[#F8F6F3] cursor-pointer transition-colors ${isSelected ? 'bg-[#EFF4F8]' : 'hover:bg-[#F7FAFC]'}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {unread && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
                          <span className="font-medium text-[#1A1A1A]">{c.username ? `@${c.username}` : c.tg_id}</span>
                          <a href={c.username ? `https://t.me/${c.username}` : `tg://user?id=${c.tg_id}`} target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-[#4A7B9D] border border-[#D0E4F0] rounded-lg px-2 py-0.5 hover:bg-[#EBF4FA] transition-colors whitespace-nowrap">
                            ✍️ Написать
                          </a>
                        </div>
                        <div className="text-xs text-[#BBB]">{c.tg_id}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        {c.status === 'replied' && lastInMsg ? (() => {
                          const sentiment = classifyReply(lastInMsg.text)
                          return sentiment === 'green'
                            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">✅ Интерес</span>
                            : sentiment === 'red'
                            ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">❌ Отказ</span>
                            : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">💬 Ответил</span>
                        })() : (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{STATUS_RU[c.status] ?? c.status}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        {lastInMsg ? <div className={`text-xs leading-relaxed truncate max-w-[200px] ${unread ? 'font-semibold text-[#1A1A1A]' : 'text-[#666]'}`}>{lastInMsg.text}</div> : <span className="text-xs text-[#CCC]">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {manager ? (
                          <div className="flex items-center gap-1.5">
                            {manager.avatar_url
                              ? <img src={manager.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                              : <div className="w-5 h-5 rounded-full bg-[#E0E8F0] flex items-center justify-center text-[10px] font-semibold text-[#666] shrink-0">{(manager.name ?? 'A')[0]}</div>
                            }
                            <div>
                              <div className="text-xs font-medium text-[#1A1A1A]">{manager.name ?? sessionToName(manager.session)}</div>
                              {manager.phone && <div className="text-xs text-[#999]">{manager.phone}</div>}
                            </div>
                          </div>
                        ) : <span className="text-xs text-[#CCC]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[#888] whitespace-nowrap">{fmt(c.sent_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-[#888] whitespace-nowrap">{fmt(c.replied_at)}</td>
                    </tr>
                    {isSelected && (
                      <tr key={`${c.id}-chat`} className="bg-[#EFF4F8]">
                        <td colSpan={6} className="px-6 py-4">
                          {contactMsgs.length === 0 ? (
                            <div className="text-xs text-[#999]">Сообщений нет</div>
                          ) : (
                            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                              {contactMsgs.map(m => (
                                <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.direction === 'out' ? 'bg-[#1A1A1A] text-white rounded-br-sm' : 'bg-white text-[#1A1A1A] border border-[#E0E8F0] rounded-bl-sm'}`}>
                                    <div className="whitespace-pre-wrap">{m.text}</div>
                                    <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-[#888]' : 'text-[#BBB]'}`}>
                                      {m.sent_at ? new Date(m.sent_at).toLocaleString('ru', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-[#888]">Нет контактов</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && <div className="px-4 py-3 text-xs text-[#999] border-t border-[#F0EBE5]">Показано 300 из {filtered.length} — уточните фильтр</div>}
        </div>
      </div>
    </div>
  )
}

// ── CRM Tab ───────────────────────────────────────────────────────────────────

type CrmStatus = 'new' | 'contacted' | 'meeting' | 'met' | 'closed' | 'refused' | 'thinking'

const CRM_STATUS: Record<CrmStatus, { label: string; color: string }> = {
  new:       { label: '🆕 Новый',              color: 'bg-gray-100 text-gray-600' },
  contacted: { label: '✉️ Написал',            color: 'bg-blue-100 text-blue-700' },
  meeting:   { label: '📅 Договорились',       color: 'bg-purple-100 text-purple-700' },
  met:       { label: '🤝 Встреча состоялась', color: 'bg-indigo-100 text-indigo-700' },
  closed:    { label: '✅ Сделка закрыта',     color: 'bg-green-100 text-green-700' },
  refused:   { label: '❌ Отказ',              color: 'bg-red-100 text-red-700' },
  thinking:  { label: '🔄 Думает',             color: 'bg-yellow-100 text-yellow-700' },
}

type CrmMessage = { id: number; direction: 'in' | 'out'; text: string; date: string }
type CrmContact = {
  id: number; name: string; username: string | null; phone: string | null
  status: CrmStatus; note: string; lastMsg: string; lastMsgDate: string
  meetingAt: string | null; messages: CrmMessage[]; source: 'outreach' | 'inbox'
}

type InboxLead = {
  tg_id: string; username: string | null; first_name: string | null; last_name: string | null
  phone: string | null; last_text: string | null; last_msg_at: string | null; status: string | null; ai_note: string | null
}
type InboxMessage = { id: number; lead_tg_id: string; text: string | null; direction: string; received_at: string | null }

function fmtShort(d: string | null) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function CrmTab({ pwd }: { pwd: string }) {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [selected, setSelected] = useState<CrmContact | null>(null)
  const [statusFilter, setStatusFilter] = useState<CrmStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadReal() {
      setLoading(true)
      try {
        const [outRes, inboxRes] = await Promise.all([
          fetch('/api/admin/outreach', { headers: { 'x-admin-secret': pwd } }),
          fetch('/api/admin/inbox',    { headers: { 'x-admin-secret': pwd } }),
        ])
        const outData   = outRes.ok   ? await outRes.json()   : null
        const inboxData = inboxRes.ok ? await inboxRes.json() : null

        const realNew: CrmContact[] = []
        let idCounter = 10000

        // 1. Зелёные из рассылки
        if (outData) {
          const { contacts: outContacts, messages: outMessages } = outData as { contacts: OutreachContact[]; messages: OutreachMessage[] }
          for (const c of outContacts) {
            if (c.status !== 'replied') continue
            const msgs = outMessages.filter(m => m.contact_id === c.id)
            const lastIn = [...msgs].reverse().find(m => m.direction === 'in')
            if (!lastIn || classifyReply(lastIn.text) !== 'green') continue
            if (!c.username) continue
            realNew.push({
              id: idCounter++, name: `@${c.username}`, username: c.username, phone: null,
              status: 'new', note: '', lastMsg: lastIn.text ?? '', lastMsgDate: fmtShort(lastIn.sent_at),
              meetingAt: null, source: 'outreach',
              messages: msgs.sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '')).map((m, i) => ({ id: i, direction: m.direction as 'in' | 'out', text: m.text ?? '', date: fmtShort(m.sent_at) })),
            })
          }
        }

        // 2. Входящие на основном аккаунте
        if (inboxData) {
          const { leads, messages: inboxMsgs } = inboxData as { leads: InboxLead[]; messages: InboxMessage[] }
          const seen = new Set(realNew.map(c => c.username).filter(Boolean))
          for (const lead of leads) {
            if (lead.username && seen.has(lead.username)) continue
            const msgs = inboxMsgs.filter(m => m.lead_tg_id === lead.tg_id).sort((a, b) => (a.received_at ?? '').localeCompare(b.received_at ?? ''))
            const aiStatus = (lead.status ?? 'new') as CrmStatus
            realNew.push({
              id: idCounter++,
              name: lead.username ? `@${lead.username}` : `${lead.first_name ?? ''}${lead.last_name ? ` ${lead.last_name}` : ''}`.trim() || `ID ${lead.tg_id}`,
              username: lead.username, phone: lead.phone,
              status: CRM_STATUS[aiStatus] ? aiStatus : 'new',
              note: lead.ai_note ?? '', lastMsg: lead.last_text ?? '', lastMsgDate: fmtShort(lead.last_msg_at),
              meetingAt: null, source: 'inbox',
              messages: msgs.map((m, i) => ({ id: i, direction: (m.direction === 'out' ? 'out' : 'in') as 'in' | 'out', text: m.text ?? '', date: fmtShort(m.received_at) })),
            })
          }
        }

        setContacts(realNew)
      } catch (e) { console.error('CRM load error', e) }
      setLoading(false)
    }
    loadReal()
  }, [pwd])

  const filtered = contacts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q) || (c.phone ?? '').includes(q)
    }
    return true
  })

  function updateStatus(id: number, status: CrmStatus) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, status } : null)
  }
  function saveNote(id: number, note: string) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, note } : c))
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, note } : null)
    setEditingNote(false)
  }

  const counts = Object.fromEntries(Object.keys(CRM_STATUS).map(s => [s, contacts.filter(c => c.status === s).length])) as Record<CrmStatus, number>

  if (loading) return <div className="text-center py-24 text-[#888]">Загрузка CRM...</div>

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)]">
      <div className="w-80 shrink-0 flex flex-col gap-3">
        <input placeholder="Поиск по имени, @username, телефону" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full text-xs border border-[#E0E8F0] rounded-xl px-3 py-2 outline-none bg-white" />
        <div className="flex flex-col gap-1">
          <button onClick={() => setStatusFilter('all')}
            className={`flex items-center justify-between text-xs px-3 py-2 rounded-xl transition-all ${statusFilter === 'all' ? 'bg-[#1A1A1A] text-white' : 'bg-white text-[#555] hover:bg-[#F0F4F8]'}`}>
            <span>Все контакты</span>
            <span className={`font-bold ${statusFilter === 'all' ? 'text-white' : 'text-[#888]'}`}>{contacts.length}</span>
          </button>
          {(Object.entries(CRM_STATUS) as [CrmStatus, { label: string; color: string }][]).map(([key, val]) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`flex items-center justify-between text-xs px-3 py-2 rounded-xl transition-all ${statusFilter === key ? 'bg-[#1A1A1A] text-white' : 'bg-white text-[#555] hover:bg-[#F0F4F8]'}`}>
              <span>{val.label}</span>
              <span className={`font-bold ${statusFilter === key ? 'text-white' : 'text-[#888]'}`}>{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="w-72 shrink-0 flex flex-col gap-2 overflow-y-auto pr-1">
        {filtered.length === 0 && <div className="text-center py-12 text-xs text-[#888]">Нет контактов</div>}
        {filtered.map(c => {
          const st = CRM_STATUS[c.status]
          return (
            <button key={c.id} onClick={() => { setSelected(c); setEditingNote(false) }}
              className={`text-left bg-white rounded-2xl p-3.5 transition-all border-2 ${selected?.id === c.id ? 'border-[#1A1A1A]' : 'border-transparent hover:border-[#E0E8F0]'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-sm text-[#1A1A1A] truncate">{c.name}</div>
                <div className="text-[10px] text-[#AAA] shrink-0 ml-2">{c.lastMsgDate}</div>
              </div>
              {c.username && <div className="text-xs text-[#888] mb-1">@{c.username}</div>}
              <div className="text-xs text-[#666] truncate mb-2">{c.lastMsg}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                {c.source === 'inbox' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">📩 Входящий</span>}
                {c.source === 'outreach' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">📤 Рассылка</span>}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex-1 bg-white rounded-2xl flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-[#CCC] text-sm">Выберите контакт</div>
        ) : (
          <>
            <div className="p-4 border-b border-[#F0EBE5]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-[#1A1A1A]">{selected.name}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {selected.username && <a href={`https://t.me/${selected.username}`} target="_blank" rel="noreferrer" className="text-xs text-[#4A7B9D] hover:underline">@{selected.username}</a>}
                    {selected.phone && <span className="text-xs text-[#888]">{selected.phone}</span>}
                  </div>
                </div>
                <select value={selected.status} onChange={e => updateStatus(selected.id, e.target.value as CrmStatus)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xl border-0 outline-none cursor-pointer ${CRM_STATUS[selected.status].color}`}>
                  {(Object.entries(CRM_STATUS) as [CrmStatus, { label: string }][]).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </div>
              <div className="mt-3">
                {editingNote ? (
                  <div className="flex gap-2">
                    <input autoFocus value={editNote} onChange={e => setEditNote(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveNote(selected.id, editNote) }}
                      className="flex-1 text-xs border border-[#E0E8F0] rounded-xl px-3 py-1.5 outline-none" placeholder="Заметка..." />
                    <button onClick={() => saveNote(selected.id, editNote)} className="text-xs bg-[#1A1A1A] text-white px-3 py-1.5 rounded-xl">Сохранить</button>
                    <button onClick={() => setEditingNote(false)} className="text-xs text-[#888] px-2">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setEditNote(selected.note); setEditingNote(true) }}
                    className="text-xs text-left w-full px-3 py-1.5 rounded-xl bg-[#F0F4F8] text-[#666] hover:bg-[#E8EFF5] transition-colors">
                    {selected.note || '+ Добавить заметку'}
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {selected.messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${m.direction === 'out' ? 'bg-[#1A1A1A] text-white rounded-br-sm' : 'bg-[#F0F4F8] text-[#1A1A1A] rounded-bl-sm'}`}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'text-[#888]' : 'text-[#AAA]'}`}>{m.date}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-[#F0EBE5] flex gap-2">
              {selected.username && (
                <a href={`https://t.me/${selected.username}`} target="_blank" rel="noreferrer"
                  className="flex-1 text-center text-xs bg-[#4A7B9D] text-white px-3 py-2 rounded-xl hover:bg-[#3a6b8d] transition-colors">
                  ✍️ Написать в Telegram
                </a>
              )}
              <button onClick={() => updateStatus(selected.id, 'closed')} className="text-xs bg-green-600 text-white px-3 py-2 rounded-xl hover:bg-green-700 transition-colors">✅ Закрыть сделку</button>
              <button onClick={() => updateStatus(selected.id, 'refused')} className="text-xs bg-red-50 text-red-600 px-3 py-2 rounded-xl hover:bg-red-100 transition-colors">❌ Отказ</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [pwd, setPwd]   = useState('')
  const [authed, setAuthed] = useState(false)
  const [tab, setTab]   = useState<'outreach' | 'crm'>('outreach')

  async function handleLogin(password: string) {
    const res = await fetch('/api/admin/outreach', { headers: { 'x-admin-secret': password } })
    if (!res.ok) { alert('Неверный пароль'); return }
    localStorage.setItem('kitai_admin_secret', password)
    setPwd(password)
    setAuthed(true)
  }

  useEffect(() => {
    const saved = localStorage.getItem('kitai_admin_secret')
    if (saved) handleLogin(saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!authed) return <LoginScreen onLogin={handleLogin} />

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#1A1A1A]">Kitai Servise — Admin</h1>
          <div className="flex gap-2">
            <button onClick={() => setTab('outreach')}
              className={`text-sm px-4 py-2 rounded-xl border transition-all ${tab === 'outreach' ? 'bg-[#1A1A1A] text-white border-transparent' : 'text-[#666] border-[#E0E8F0]'}`}>
              📤 Рассылка
            </button>
            <button onClick={() => setTab('crm')}
              className={`text-sm px-4 py-2 rounded-xl border transition-all ${tab === 'crm' ? 'bg-[#1A1A1A] text-white border-transparent' : 'text-[#666] border-[#E0E8F0]'}`}>
              🗂 CRM
            </button>
          </div>
        </div>
        {tab === 'outreach' ? <OutreachTab pwd={pwd} /> : <CrmTab pwd={pwd} />}
      </div>
    </div>
  )
}
