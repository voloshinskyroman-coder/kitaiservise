'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useTelegramContentInset } from '@/lib/telegram/useTelegramContentInset'

const STATS = [
  {
    value: '15+',
    label: 'лет опыта',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.5 4 5.5v5.5c0 5 3.4 8.9 8 10.5 4.6-1.6 8-5.5 8-10.5V5.5L12 2.5Z M12 8.25 12.9 10.1 15 10.4 13.5 11.85 13.85 13.95 12 12.97 10.15 13.95 10.5 11.85 9 10.4 11.1 10.1 12 8.25Z"
      />
    ),
  },
  {
    value: '100к+',
    label: 'успешных перевозок',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.25 12 12.75 3.75 8.25M12 12.75V21M3.75 8.25 12 3.75l8.25 4.5v7.5L12 20.25l-8.25-4.5v-7.5Z"
      />
    ),
  },
  {
    value: '98%',
    label: 'доставлено в срок',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />,
  },
]

const PARTNERS = [
  { name: 'DNS', logo: '/partner-dns.png', width: 764, height: 300 },
  { name: 'М.Видео', logo: '/partner-mvideo.png', width: 627, height: 279 },
  { name: 'ВсеИнструменты', logo: '/partner-vseinstrumenti.png', width: 1680, height: 897 },
  { name: 'Т-Банк', logo: '/partner-tbank.png', width: 469, height: 189 },
]

export default function Home() {
  const contentInset = useTelegramContentInset()
  const router = useRouter()
  const checkedRef = useRef(false)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    // Скрипт telegram-web-app.js грузится с strategy="beforeInteractive" в layout —
    // к этому моменту window.Telegram.WebApp уже гарантированно доступен.
    const webApp = window.Telegram?.WebApp
    if (!webApp) return

    // Если у пользователя уже есть незавершённая сессия квиза — сразу переходим туда,
    // а не показываем "Начать расчёт" (иначе кажется, что расчёт начнётся заново).
    void fetch('/api/telegram/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: webApp.initData, checkOnly: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.sessionId) router.replace('/quiz')
      })
  }, [router])

  return (
    <>
      <div className="flex min-h-dvh flex-col bg-[#F7F8FA] text-foreground">
        <main
          className="mx-auto flex w-full max-w-md flex-col gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          style={{
            paddingBottom: contentInset.bottom ? `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${contentInset.bottom}px)` : undefined,
          }}
        >
          <div className="relative">
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image
                src="/truck-photo.png"
                alt="Грузовик Китай Сервис с контейнером на фоне китайского города"
                fill
                priority
                sizes="(max-width: 448px) 100vw, 448px"
                className="object-cover object-bottom"
              />

              <div
                className="absolute inset-x-0 top-0 flex flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))]"
                style={{
                  paddingTop: contentInset.top ? `calc(max(1rem, env(safe-area-inset-top)) + ${contentInset.top}px)` : undefined,
                }}
              >
                <div className="flex flex-nowrap items-center justify-between gap-2">
                  <div className="min-w-0 shrink">
                    <Image
                      src="/user-photo.jpg"
                      alt="Китай Сервис"
                      width={466}
                      height={190}
                      priority
                      className="h-9 w-auto [mix-blend-mode:multiply]"
                    />
                  </div>

                  <div className="flex shrink-0 items-center justify-center gap-1.5 rounded-[22px] border border-border bg-white px-2.5 py-1.5 text-center">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-primary" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M12 2.75 4.5 5.5v6c0 4.6 3.2 8.7 7.5 9.75 4.3-1.05 7.5-5.15 7.5-9.75v-6L12 2.75Z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" stroke="white" strokeWidth={1.75} fill="none" d="m9 12 2 2 4-4" />
                    </svg>
                    <div className="text-[10px] leading-snug">
                      <div className="whitespace-nowrap font-medium">Данные защищены</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h1 className="text-2xl font-bold leading-tight tracking-tight">Доставка грузов из Китая</h1>
                  <p className="mt-2 text-sm leading-snug text-muted">
                    Узнайте стоимость доставки <span className="font-bold text-primary">за 5 минут</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#F7F8FA] to-transparent" />
          </div>

          <div className="relative z-10 -mt-10 grid grid-cols-3 gap-2 px-5">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center gap-2 rounded-[20px] bg-white px-2 py-4 text-center shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6" aria-hidden="true">
                    {s.icon}
                  </svg>
                </div>
                <div className="whitespace-nowrap text-xl font-extrabold leading-none tracking-tight text-primary">{s.value}</div>
                <div className="text-[11px] leading-tight text-muted">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 px-5">
            <Link
              href="/quiz"
              className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-[22px] bg-cta px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-cta-hover"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4" aria-hidden="true">
                  <rect x="5" y="3.5" width="14" height="17" rx="2" />
                  <path strokeLinecap="round" d="M8 7.5h8M8 11.25h2m3.5 0h2M8 15h2m3.5 0h2" />
                </svg>
              </span>
              <span className="flex-1">Начать расчёт</span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6 19.5 12l-6 6M19.5 12H4.5" />
                </svg>
              </span>
            </Link>
          </div>

          <div className="px-5 text-center">
            <p className="text-xs font-medium text-muted">С нами работают</p>
            <div className="mt-3 flex flex-nowrap items-center justify-center gap-4">
              {PARTNERS.map((p) => (
                <Image key={p.name} src={p.logo} alt={p.name} width={p.width} height={p.height} className="h-6 w-auto" />
              ))}
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
