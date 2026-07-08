import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  getPurposeLabel,
  labelsForValues,
  ALL_DOCUMENT_OPTIONS,
  EXTRA_SERVICES_OPTIONS,
  NON_TARIFF_OPTIONS,
  LOGISTICS_METHOD_OPTIONS,
} from '@/lib/config/decisionTree'
import { ACCURACY_LABEL } from '@/lib/engines/recommendationEngine'
import {
  formatPrice,
  formatDays,
  DELIVERY_MODE_LABEL,
  TEMPERATURE_EMOJI,
  READINESS_LABEL,
  DELIVERY_URGENCY_LABEL,
  PRIOR_EXPERIENCE_LABEL,
  CLIENT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  CONTRACT_HOLDER_LABEL,
  DESTINATION_TYPE_LABEL,
  URGENCY_LABEL,
} from '@/lib/engines/logisticEngine'
import { setLogistStatus, setHsCodeConfirmed } from '@/lib/actions/shipments'
import type { Shipment, LogistStatus } from '@/lib/types/shipment'

const LOGIST_STATUS_LABEL: Record<LogistStatus, string> = { new: 'Новая', contacted: 'В работе', closed: 'Закрыта' }

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between border-b border-neutral-800 py-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-100">{value}</span>
    </div>
  )
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerSupabaseClient()
  const { data: lead } = await supabase.from('shipments').select('*').eq('id', id).single<Shipment>()

  if (!lead) notFound()

  const temperature = lead.lead_temperature ?? 'cold'

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-neutral-950 p-8 text-neutral-100">
      <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Все лиды
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">
        {TEMPERATURE_EMOJI[temperature]} {getPurposeLabel(lead.purpose)}
      </h1>
      <p className="mt-1 text-neutral-400">
        {lead.telegram_username ? `@${lead.telegram_username}` : `Telegram id${lead.telegram_user_id ?? '—'}`}
      </p>

      <div className="mt-4 flex gap-2">
        {(['new', 'contacted', 'closed'] as LogistStatus[]).map((s) => (
          <form key={s} action={setLogistStatus.bind(null, lead.id, s)}>
            <button
              type="submit"
              disabled={lead.logist_status === s}
              className={`rounded-full px-3 py-1 text-sm ${
                lead.logist_status === s ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-800 text-neutral-300'
              }`}
            >
              {LOGIST_STATUS_LABEL[s]}
            </button>
          </form>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-neutral-800 p-4">
        <Field label="Тип клиента" value={lead.client_type != null ? CLIENT_TYPE_LABEL[lead.client_type] : null} />
        <Field label="Опыт с Китаем" value={lead.prior_experience ? PRIOR_EXPERIENCE_LABEL[lead.prior_experience] : null} />
        <Field label="Категория" value={lead.category} />
        <Field label="Товар" value={lead.product_description} />
        <Field label="Поставщик" value={lead.supplier} />
        <Field label="Способ оплаты" value={lead.payment_method ? (PAYMENT_METHOD_LABEL[lead.payment_method] ?? lead.payment_method) : null} />
        <Field label="Перевод денег поставщику" value={lead.needs_money_transfer ? 'нужен' : null} />
        <Field label="Откуда" value={lead.origin_city} />
        <Field label="Куда доставить" value={lead.destination_type ? DESTINATION_TYPE_LABEL[lead.destination_type] : null} />
        <Field label="Город доставки" value={lead.destination_city} />
        <Field label="Способ доставки" value={lead.delivery_mode ? DELIVERY_MODE_LABEL[lead.delivery_mode] : null} />
        <Field label="Вес" value={lead.weight_kg != null ? `${lead.weight_kg} кг` : null} />
        <Field label="Объём" value={lead.volume_m3 != null ? `${lead.volume_m3.toFixed(3)} м³` : null} />
        <Field label="Количество мест" value={lead.package_count} />
        <Field
          label="Стоимость товара"
          value={lead.product_cost != null ? `${lead.product_cost.toLocaleString('ru-RU')} ${lead.currency ?? 'RUB'}` : null}
        />
        <Field label="Бюджет на закупку" value={lead.purchase_budget != null ? `${lead.purchase_budget.toLocaleString('ru-RU')} ₽` : null} />
        <Field label="Срочность" value={lead.urgency ? URGENCY_LABEL[lead.urgency] : null} />
        <Field label="Готовность груза" value={lead.cargo_readiness ? READINESS_LABEL[lead.cargo_readiness] : null} />
        <Field label="Срочность доставки" value={lead.delivery_urgency ? DELIVERY_URGENCY_LABEL[lead.delivery_urgency] : null} />
        <Field
          label="Документы"
          value={lead.documents.length ? labelsForValues(ALL_DOCUMENT_OPTIONS, lead.documents).join(', ') : null}
        />
        <Field
          label="Сертификаты/маркировка"
          value={lead.non_tariff_services.length ? labelsForValues(NON_TARIFF_OPTIONS, lead.non_tariff_services).join(', ') : null}
        />
        <Field label="Контракт оформления" value={lead.customs_contract_holder ? CONTRACT_HOLDER_LABEL[lead.customs_contract_holder] : null} />
        <Field
          label="Способ логистики"
          value={lead.logistics_method ? labelsForValues(LOGISTICS_METHOD_OPTIONS, [lead.logistics_method])[0] : null}
        />
        <Field
          label="Доп. услуги"
          value={lead.extra_services.length ? labelsForValues(EXTRA_SERVICES_OPTIONS, lead.extra_services).join(', ') : null}
        />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 p-4">
        <Field label="Расчёт" value={`${formatPrice(lead)} (${ACCURACY_LABEL[lead.calculation_accuracy ?? 'low']})`} />
        <Field label="Маршрут" value={lead.estimated_route} />
        <Field label="Срок" value={formatDays(lead)} />
        <Field label="Скоринг" value={`${lead.lead_score} (${temperature})`} />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-800 p-4">
        <p className="text-sm text-neutral-500">Код ТН ВЭД</p>
        <Field
          label="Предложен AI"
          value={lead.hs_code_suggested ? `${lead.hs_code_suggested}${lead.hs_code_suggested_description ? ' ✅ сверен' : ' ⚠️ не найден в классификаторе'}` : null}
        />
        <Field label="Официальное наименование" value={lead.hs_code_suggested_description} />
        <Field label="Уверенность AI" value={lead.ai_confidence != null ? `${lead.ai_confidence}%` : null} />
        <Field
          label="AI: документы для этого товара"
          value={lead.ai_suggested_documents.length ? labelsForValues(ALL_DOCUMENT_OPTIONS, lead.ai_suggested_documents).join(', ') : null}
        />
        <Field
          label="AI: сертификация/маркировка"
          value={lead.ai_suggested_non_tariff.length ? labelsForValues(NON_TARIFF_OPTIONS, lead.ai_suggested_non_tariff).join(', ') : null}
        />
        <form action={setHsCodeConfirmed.bind(null, lead.id)} className="mt-2 flex gap-2">
          <input
            type="text"
            name="hs_code_confirmed"
            defaultValue={lead.hs_code_confirmed ?? ''}
            placeholder="Код, подтверждённый логистом"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button type="submit" className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900">
            Сохранить
          </button>
        </form>
      </div>

      {lead.attachment_path && (
        <div className="mt-4 rounded-xl border border-neutral-800 p-4">
          <p className="text-sm text-neutral-500">📎 Вложение</p>
          <p className="mt-1 text-sm text-neutral-100">Инвойс/упаковочный лист прикреплён (файл отправлен вместе с заявкой в Telegram)</p>
          {lead.attachment_ai_summary && (
            <p className="mt-2 text-sm text-neutral-300">🤖 {lead.attachment_ai_summary}</p>
          )}
        </div>
      )}

      {lead.client_comment && (
        <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-200">
          📝 {lead.client_comment}
        </p>
      )}

      {lead.system_comments && (
        <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-200">
          💬 {lead.system_comments}
        </p>
      )}

      <details className="mt-4 rounded-xl border border-neutral-800 p-4">
        <summary className="cursor-pointer text-sm text-neutral-400">История ответов ({lead.answers_log.length})</summary>
        <ol className="mt-3 space-y-1 text-sm text-neutral-300">
          {lead.answers_log.map((entry, i) => (
            <li key={i}>
              <span className="text-neutral-500">{entry.question_id}:</span> {String(entry.answer)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}
