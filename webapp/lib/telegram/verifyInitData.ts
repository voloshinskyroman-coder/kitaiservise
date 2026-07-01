import 'server-only'
import crypto from 'node:crypto'

export interface TelegramInitDataUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
}

export interface VerifiedInitData {
  user: TelegramInitDataUser | null
  authDate: number
}

/**
 * Проверка подписи Telegram WebApp initData по алгоритму из документации:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramInitData(initData: string, botToken: string): VerifiedInitData | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null

  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (computedHash !== hash) return null

  const authDate = Number(params.get('auth_date') ?? 0)
  const MAX_AGE_SECONDS = 24 * 60 * 60
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null

  const userRaw = params.get('user')
  const user = userRaw ? (JSON.parse(userRaw) as TelegramInitDataUser) : null

  return { user, authDate }
}
