'use client'

import Script from 'next/script'
import { useState } from 'react'
import type { SerializedQuestion } from '@/lib/engines/decisionEngine'
import type { PublicShipment } from '@/lib/types/publicShipment'
import { ACCURACY_LABEL } from '@/lib/engines/recommendationEngine'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
      }
    }
  }
}

export default function QuizPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<SerializedQuestion | null>(null)
  const [shipment, setShipment] = useState<PublicShipment | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleTelegramReady() {
    const webApp = window.Telegram?.WebApp
    if (!webApp) {
      setError('Открой это приложение через Telegram')
      return
    }

    webApp.ready()
    webApp.expand()

    const res = await fetch('/api/telegram/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: webApp.initData }),
    })

    if (!res.ok) {
      setError('Не удалось начать сессию')
      return
    }

    const data = await res.json()
    setSessionId(data.sessionId)
    setQuestion(data.question)
  }

  async function submitAnswer(answer: string) {
    if (!sessionId || !question) return

    const res = await fetch('/api/shipment/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, questionId: question.id, answer }),
    })

    if (!res.ok) {
      setError('Не удалось сохранить ответ')
      return
    }

    const data = await res.json()
    setShipment(data.shipment)
    setHint(data.hint)
    setQuestion(data.nextQuestion)
    setInputValue('')
  }

  const isFinished = sessionId && !question

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={handleTelegramReady}
      />
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 bg-white p-6">
        {error && <p className="text-center text-red-600">{error}</p>}

        {!error && !sessionId && <p className="text-center text-neutral-500">Загрузка...</p>}

        {shipment && shipment.estimated_price_min != null && (
          <div className="rounded-xl bg-neutral-100 p-4 text-center">
            <p className="text-sm text-neutral-500">Ориентировочно ({ACCURACY_LABEL[shipment.calculation_accuracy ?? 'low']})</p>
            <p className="text-xl font-semibold">
              {shipment.estimated_price_min.toLocaleString('ru-RU')}–{shipment.estimated_price_max?.toLocaleString('ru-RU')} ₽
            </p>
            {shipment.estimated_route && (
              <p className="text-sm text-neutral-500">
                {shipment.estimated_route} · {shipment.estimated_delivery_days_min}–{shipment.estimated_delivery_days_max} дней
              </p>
            )}
            {hint && <p className="mt-2 text-xs text-neutral-400">{hint}</p>}
          </div>
        )}

        {question && (
          <div>
            <h1 className="mb-4 text-lg font-medium">{question.prompt}</h1>

            {question.type === 'choice' && (
              <div className="flex flex-col gap-2">
                {question.options?.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => submitAnswer(opt.value)}
                    className="rounded-lg border border-neutral-300 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {(question.type === 'number' || question.type === 'text') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (inputValue.trim()) submitAnswer(inputValue.trim())
                }}
                className="flex gap-2"
              >
                <input
                  type={question.type === 'number' ? 'number' : 'text'}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  autoFocus
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-neutral-500"
                />
                <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2 text-white">
                  Далее
                </button>
              </form>
            )}
          </div>
        )}

        {isFinished && (
          <div className="text-center">
            <h1 className="text-lg font-semibold">Заявка принята</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Это предварительный расчёт. Менеджер посмотрит заявку и свяжется с вами для окончательной стоимости.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
