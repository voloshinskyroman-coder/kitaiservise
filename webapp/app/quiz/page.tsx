'use client'

import { useEffect, useRef, useState } from 'react'
import { getStartQuestion, type SerializedQuestion } from '@/lib/engines/decisionEngine'
import type { PublicShipment } from '@/lib/types/publicShipment'
import type { QuestionOption } from '@/lib/config/decisionTree'

// Опции с явным description (полноценное пояснение) показываем как заголовок + текст.
// Остальные лейблы часто идут в формате "Основной текст (уточнение)" — разбиваем эвристикой,
// чтобы длинные логистические формулировки не сливались в кашу.
function splitOptionLabel(opt: QuestionOption): { main: string; detail: string | null } {
  if (opt.description) return { main: opt.label, detail: opt.description }
  const match = opt.label.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!match) return { main: opt.label, detail: null }
  return { main: match[1], detail: match[2] }
}

export default function QuizPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Первый вопрос известен заранее и не зависит от сервера — рисуем его сразу,
  // не дожидаясь ответа /api/telegram/verify. Если сессия окажется незавершённой
  // (резюме), состояние ниже подменится настоящим шагом, как только придёт ответ.
  const [question, setQuestion] = useState<SerializedQuestion | null>(() => getStartQuestion())
  const [history, setHistory] = useState<Array<{ question: SerializedQuestion; step: number }>>([])
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PublicShipment | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const startedRef = useRef(false)

  async function startSession() {
    if (startedRef.current) return
    startedRef.current = true

    // Скрипт telegram-web-app.js грузится с strategy="beforeInteractive" в layout —
    // к этому моменту window.Telegram.WebApp уже гарантированно доступен.
    const webApp = window.Telegram?.WebApp
    if (!webApp) {
      setError('Открой это приложение через Telegram')
      setQuestion(null)
      startedRef.current = false
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
      setQuestion(null)
      return
    }

    const data = await res.json()
    setSessionId(data.sessionId)
    setQuestion(data.question)
    setSelectedValues(data.question?.preselected ?? [])
    setStep(data.step ?? 0)
    setHistory(data.history ?? [])
  }

  useEffect(() => {
    const id = setTimeout(() => { void startSession() }, 0)
    return () => clearTimeout(id)
  }, [])

  // Пока sessionId ещё не пришёл, оптимистично показанный вопрос уже на экране,
  // но отвечать на него ещё нельзя — блокируем взаимодействие вместо тихого no-op.
  const interactionDisabled = submitting || !sessionId

  // Подсказки по мере ввода (Google Product Taxonomy, см. /api/product-suggest) — только для
  // вопросов с autocomplete: true, с debounce, чтобы не долбить API на каждый символ.
  useEffect(() => {
    const autocomplete = question?.autocomplete
    const query = inputValue.trim()
    const id = setTimeout(() => {
      if (!autocomplete || query.length < 2) {
        setSuggestions([])
        return
      }
      fetch(`/api/product-suggest?q=${encodeURIComponent(query)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setSuggestions(data?.suggestions?.map((s: { leaf_name: string }) => s.leaf_name) ?? []))
        .catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(id)
  }, [inputValue, question?.autocomplete])

  async function submitAnswer(answer: string) {
    if (!sessionId || !question || submitting) return
    setSubmitting(true)

    const res = await fetch('/api/shipment/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, questionId: question.id, answer }),
    })

    if (!res.ok) {
      setError('Не удалось сохранить ответ')
      setSubmitting(false)
      return
    }

    const data = await res.json()
    setHistory((h) => [...h, { question, step }])
    setQuestion(data.nextQuestion)
    setInputValue('')
    setSelectedValues(data.nextQuestion?.preselected ?? [])
    setStep((s) => s + 1)
    setSubmitting(false)
    if (!data.nextQuestion) setResult(data.shipment)
  }

  function goBack() {
    if (submitting || history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setQuestion(prev.question)
    setStep(prev.step)
    setInputValue('')
    setSelectedValues(prev.question.preselected ?? [])
    setError(null)
  }

  function toggleValue(value: string) {
    setSelectedValues((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  const isFinished = sessionId && !question

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-foreground">
      {question && (
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting}
              aria-label="Назад"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors duration-200 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 6 9 12l6 6" />
              </svg>
            </button>
          )}
          <div className="flex flex-1 items-center gap-2.5 text-xs font-medium text-muted">
            <span className="shrink-0">Шаг {step + 1}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.min(90, (step + 1) * 18)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col justify-center gap-8">
        {error && <p className="text-center text-red-600">{error}</p>}

        {question?.type === 'info' && (
          <div className="flex flex-col gap-5 rounded-2xl bg-surface p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 11v5m0-8h.01" />
              </svg>
            </span>
            <p className="text-base leading-relaxed text-foreground">{question.prompt}</p>
            <button
              onClick={() => submitAnswer('ok')}
              disabled={interactionDisabled}
              className="min-h-[56px] w-full cursor-pointer rounded-2xl bg-cta px-5 font-semibold text-white transition-colors duration-200 hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Понятно, дальше
            </button>
          </div>
        )}

        {question && question.type !== 'info' && (
          <div className="flex flex-col gap-6">
            <h1 className="text-xl font-semibold leading-snug tracking-tight">{question.prompt}</h1>

            {question.type === 'choice' && (
              <div className="flex flex-col gap-3">
                {question.options?.map((opt) => {
                  const { main, detail } = splitOptionLabel(opt)
                  return (
                    <button
                      key={opt.value}
                      onClick={() => submitAnswer(opt.value)}
                      disabled={interactionDisabled}
                      className="min-h-[56px] cursor-pointer rounded-2xl border border-border px-5 py-3.5 text-left transition-colors duration-200 hover:border-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="block text-base font-medium leading-snug">{main}</span>
                      {detail && <span className="mt-0.5 block text-sm leading-snug text-muted">{detail}</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {question.type === 'multi-choice' && (
              <div className="flex flex-col gap-5">
                {question.preselected && question.preselected.length > 0 && (
                  <p className="rounded-xl bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
                    Мы автоматически определили необходимые документы для выбранного товара. При необходимости вы можете изменить выбор.
                  </p>
                )}
                <div className="flex flex-col gap-3">
                  {question.options?.map((opt) => {
                    const checked = selectedValues.includes(opt.value)
                    const { main, detail } = splitOptionLabel(opt)
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleValue(opt.value)}
                        disabled={interactionDisabled}
                        className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-2xl border px-5 py-3.5 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                          checked ? 'border-primary bg-surface' : 'border-border hover:bg-surface'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md border ${
                            checked ? 'border-primary bg-primary' : 'border-border'
                          }`}
                        >
                          {checked && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="h-3 w-3" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span>
                          <span className="block text-base font-medium leading-snug">{main}</span>
                          {detail && <span className="mt-0.5 block text-sm leading-snug text-muted">{detail}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => submitAnswer(JSON.stringify(selectedValues))}
                  disabled={interactionDisabled || (!question.optional && selectedValues.length === 0)}
                  className="min-h-[56px] w-full cursor-pointer rounded-2xl bg-cta px-5 font-semibold text-white transition-colors duration-200 hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Далее
                </button>
              </div>
            )}

            {(question.type === 'number' || question.type === 'text') && (
              <div className="flex flex-col gap-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (inputValue.trim()) submitAnswer(inputValue.trim())
                  }}
                  className="flex gap-2"
                >
                  <div className="relative flex-1">
                    <input
                      type={question.type === 'number' ? 'number' : 'text'}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      autoFocus
                      disabled={interactionDisabled}
                      autoComplete="off"
                      className="min-h-[56px] w-full rounded-2xl border border-border px-5 text-base outline-none transition-colors duration-200 focus:border-primary disabled:opacity-60"
                    />
                    {suggestions.length > 0 && (
                      <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-10 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setInputValue(s)
                              setSuggestions([])
                            }}
                            className="cursor-pointer px-5 py-3 text-left text-base transition-colors duration-200 hover:bg-surface"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={interactionDisabled || !inputValue.trim()}
                    className="min-h-[56px] min-w-[56px] cursor-pointer rounded-2xl bg-cta px-5 font-semibold text-white transition-colors duration-200 hover:bg-cta-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? '...' : 'Далее'}
                  </button>
                </form>
                {question.optional && (
                  <button
                    type="button"
                    onClick={() => submitAnswer('')}
                    disabled={interactionDisabled}
                    className="flex min-h-[44px] cursor-pointer items-center justify-center self-center px-4 text-sm text-muted underline-offset-2 hover:underline disabled:cursor-not-allowed"
                  >
                    Пропустить
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isFinished && !confirmed && (
          <div>
            {result && result.estimated_price_min != null ? (
              <div className="rounded-2xl bg-surface p-6 text-center">
                <p className="text-sm text-muted">Ориентировочная стоимость</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-primary">
                  {result.estimated_price_min.toLocaleString('ru-RU')}–{result.estimated_price_max?.toLocaleString('ru-RU')} ₽
                </p>
                {result.estimated_route && (
                  <p className="mt-2 text-sm text-muted">
                    {result.estimated_route} · {result.estimated_delivery_days_min}–{result.estimated_delivery_days_max} дней
                  </p>
                )}
                <ul className="mt-5 space-y-2 text-left text-sm leading-relaxed text-muted">
                  <li>• Доставка от склада в Китае до вашего города</li>
                  <li>• Отслеживание груза на всём пути</li>
                  <li>• Поддержка менеджера до получения груза</li>
                </ul>
              </div>
            ) : (
              <p className="text-center leading-relaxed text-muted">Спасибо! Наш менеджер свяжется с вами для консультации.</p>
            )}

            <button
              onClick={() => setConfirmed(true)}
              className="mt-5 flex min-h-[56px] w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-cta px-4 text-base font-semibold text-white transition-colors duration-200 hover:bg-cta-hover"
            >
              Получить точный расчёт
            </button>
          </div>
        )}

        {isFinished && confirmed && (
          <div className="flex flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-7 w-7" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </span>
            <h1 className="mt-4 text-lg font-semibold">Заявка принята</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Это предварительный расчёт. Менеджер посмотрит заявку и свяжется с вами для окончательной стоимости.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
