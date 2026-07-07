'use client'

import { useEffect, useState } from 'react'

/**
 * Telegram рисует свои кнопки (Закрыть, ···) поверх контента в развёрнутом Mini App —
 * contentSafeAreaInset (Bot API 8.0+) отдаёт именно этот отступ, отдельно от выреза устройства
 * (тот уже покрыт CSS env(safe-area-inset-*)). Складывать их нельзя — они про разные вещи.
 */
export function useTelegramContentInset() {
  const [inset, setInset] = useState({ top: 0, bottom: 0 })

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    if (!webApp) return

    function read() {
      const c = webApp?.contentSafeAreaInset
      setInset({ top: c?.top ?? 0, bottom: c?.bottom ?? 0 })
    }

    webApp.ready()
    webApp.expand()
    read()
    webApp.onEvent?.('contentSafeAreaChanged', read)
    return () => webApp.offEvent?.('contentSafeAreaChanged', read)
  }, [])

  return inset
}
