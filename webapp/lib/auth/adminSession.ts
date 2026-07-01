import 'server-only'
import crypto from 'node:crypto'

export const ADMIN_SESSION_COOKIE = 'admin_session'
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

interface SessionPayload {
  username: string
  exp: number
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET не задан')
  return secret
}

function sign(value: string): string {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url')
}

export function createAdminSessionToken(username: string): string {
  const payload: SessionPayload = { username, exp: Date.now() + SESSION_TTL_SECONDS * 1000 }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(encoded)
  return `${encoded}.${signature}`
}

export function verifyAdminSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null

  const expectedSignature = sign(encoded)
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expectedSignature)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload
  if (payload.exp < Date.now()) return null

  return payload
}

export { SESSION_TTL_SECONDS }
