'use client'

import { useRouter } from 'next/navigation'

export function LogoutButton({ light }: { light?: boolean } = {}) {
  const router = useRouter()

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className={
        light
          ? 'rounded-lg border border-[#E0DBD5] px-3 py-1.5 text-sm text-[#666]'
          : 'rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300'
      }
    >
      Выйти
    </button>
  )
}
