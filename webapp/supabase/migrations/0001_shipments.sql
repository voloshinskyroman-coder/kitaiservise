-- Shipment: единая модель перевозки, обновляется после каждого ответа в квизе.
create extension if not exists pgcrypto;

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),

  telegram_user_id bigint,
  telegram_username text,

  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),

  -- цель обращения и сценарий
  purpose text,
  scenario text,

  -- параметры доставки
  delivery_mode text check (delivery_mode in ('cargo', 'white')),
  category text,
  product_description text,
  origin_city text,
  destination_city text,
  supplier text,
  supplier_status text,
  payment_status text,

  -- количественные параметры
  product_cost numeric,
  weight_kg numeric,
  volume_m3 numeric,
  package_count integer,
  box_dimensions jsonb,

  extra_services text[] not null default '{}',
  documents jsonb not null default '[]',

  -- результат расчета (пересчитывается после каждого ответа)
  estimated_route text,
  estimated_delivery_days_min integer,
  estimated_delivery_days_max integer,
  estimated_price_min numeric,
  estimated_price_max numeric,
  calculation_accuracy text check (calculation_accuracy in ('low', 'medium', 'high')),

  -- скоринг (скрыт от пользователя)
  lead_score integer not null default 0,
  lead_temperature text check (lead_temperature in ('hot', 'warm', 'cold')),

  system_comments text,
  answers_log jsonb not null default '[]',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_telegram_user_id_idx on shipments (telegram_user_id);
create index if not exists shipments_status_idx on shipments (status);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists shipments_set_updated_at on shipments;
create trigger shipments_set_updated_at
  before update on shipments
  for each row execute function set_updated_at();

-- Доступ только через service role (сервер), с клиента таблица напрямую не читается.
alter table shipments enable row level security;
