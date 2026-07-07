-- Новые поля под расширенный квиз (3 ветки: уже куплен / хочу купить / узнать стоимость).
alter table shipments
  add column if not exists currency text check (currency in ('CNY', 'USD', 'RUB')),
  add column if not exists cargo_readiness text check (cargo_readiness in ('ready', 'week', 'month', 'unknown')),
  add column if not exists certificates_note text,
  add column if not exists needs_money_transfer boolean;
