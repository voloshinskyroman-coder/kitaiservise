import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from './adminSession'

/** Проверяет cookie-сессию админки в API-роуте. Возвращает 401-ответ, если сессии нет. */
export function requireAdminSession(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value
  const session = verifyAdminSessionToken(token)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return null
}
