import { LogoutButton } from './LogoutButton'

export default function AdminHomePage() {
  return (
    <div className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <h1 className="text-2xl font-semibold">Админ-панель KitaiService</h1>
      <p className="mt-2 text-neutral-400">
        Гейт входа готов (M1). Список лидов и карточка Shipment появятся в M6.
      </p>
      <div className="mt-6">
        <LogoutButton />
      </div>
    </div>
  )
}
