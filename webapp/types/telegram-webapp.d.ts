export {}

interface TelegramSafeAreaInset {
  top: number
  bottom: number
  left: number
  right: number
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
        safeAreaInset?: TelegramSafeAreaInset
        contentSafeAreaInset?: TelegramSafeAreaInset
        onEvent?: (eventType: string, callback: () => void) => void
        offEvent?: (eventType: string, callback: () => void) => void
      }
    }
  }
}
