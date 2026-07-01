import Link from 'next/link'
import { LogoutButton } from './LogoutButton'

const SECTIONS = [
  { href: '/admin/leads', title: 'Заявки', description: 'Список лидов и карточка заявки' },
  { href: '/admin/funnel', title: 'Воронка', description: 'Кто открыл Mini App, отвечает или подал заявку' },
  { href: '/admin/outreach', title: 'Рассылка', description: 'Аккаунты, контакты и диалоги холодной рассылки' },
  { href: '/admin/crm', title: 'CRM', description: 'Единый пайплайн: заявки + положительные ответы на рассылку' },
]

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <h1 className="text-2xl font-semibold">Админ-панель KitaiService</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5 transition-colors hover:border-neutral-600"
          >
            <div className="font-semibold text-neutral-100">{s.title}</div>
            <div className="mt-1 text-sm text-neutral-500">{s.description}</div>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <LogoutButton />
      </div>
    </div>
  )
}
