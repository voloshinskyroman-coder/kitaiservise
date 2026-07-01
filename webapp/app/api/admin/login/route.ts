import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { ADMIN_SESSION_COOKIE, createAdminSessionToken, SESSION_TTL_SECONDS } from '@/lib/auth/adminSession'

export async function POST(req: NextRequest) {
  const { username, password } = (await req.json()) as { username?: string; password?: string }

  const expectedUsername = process.env.ADMIN_USERNAME
  const expectedPasswordHash = process.env.ADMIN_PASSWORD_HASH

  if (!expectedUsername || !expectedPasswordHash) {
    return NextResponse.json({ error: 'Админ не настроен' }, { status: 500 })
  }

  if (!username || !password || username !== expectedUsername) {
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 })
  }

  const passwordOk = await bcrypt.compare(password, expectedPasswordHash)
  if (!passwordOk) {
    return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 })
  }

  const token = createAdminSessionToken(username)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  return res
}
