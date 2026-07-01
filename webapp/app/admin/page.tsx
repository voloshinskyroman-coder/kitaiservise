import Link from 'next/link'
import { LogoutButton } from './LogoutButton'

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <h1 className="text-2xl font-semibold">Админ-панель KitaiService</h1>
      <Link href="/admin/leads" className="mt-4 inline-block rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-900">
        Лиды
      </Link>
      <div className="mt-6">
        <LogoutButton />
      </div>
    </div>
  )
}
