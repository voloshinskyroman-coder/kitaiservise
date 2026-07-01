-- Outreach: таблицы для холодной рассылки KitaiService (движок bots/outreach, свой изолированный
-- пул аккаунтов/данных, отдельный от Vellar Home). Заполняются Telethon-демоном при синке.
-- Схема повторяет vellarhome/supabase/migrations/004_outreach_dashboard.sql + ad-hoc колонки,
-- которые демон Vellar пишет туда без миграции (flood_count/name/avatar_url/created_at).

create table if not exists outreach_accounts (
  id           integer primary key,
  session      text unique not null,
  phone        text,
  gender       text,
  status       text default 'active',
  daily_limit  integer default 50,
  hourly_limit integer default 8,
  paused_until timestamptz,
  flood_count  integer default 0,
  sent_today   integer default 0,
  name         text,
  avatar_url   text,
  created_at   timestamptz default now(),
  synced_at    timestamptz default now()
);

create table if not exists outreach_contacts (
  id              integer primary key,
  tg_id           text,
  username        text,
  status          text default 'new',
  account_id      integer references outreach_accounts (id),
  account_session text,
  imported_at     timestamptz,
  sent_at         timestamptz,
  replied_at      timestamptz,
  synced_at       timestamptz default now()
);

create table if not exists outreach_messages (
  id         integer primary key,
  contact_id integer references outreach_contacts (id),
  account_id integer references outreach_accounts (id),
  direction  text,
  text       text,
  sent_at    timestamptz,
  synced_at  timestamptz default now()
);

create table if not exists outreach_conversations (
  id         integer primary key,
  contact_id integer references outreach_contacts (id),
  account_id integer references outreach_accounts (id),
  status     text default 'open',
  ai_draft   text,
  created_at timestamptz,
  updated_at timestamptz,
  synced_at  timestamptz default now()
);

-- Лог прогревной активности аккаунтов за день (чтение/реакции/интер-сообщения, прокси события).
create table if not exists outreach_activity (
  id        bigint generated always as identity primary key,
  session   text not null,
  type      text not null,
  detail    text,
  done_at   timestamptz not null default now(),
  synced_at timestamptz default now()
);

create index if not exists outreach_contacts_status_idx on outreach_contacts (status);
create index if not exists outreach_contacts_account_session_idx on outreach_contacts (account_session);
create index if not exists outreach_messages_contact_id_idx on outreach_messages (contact_id);
create index if not exists outreach_conversations_status_idx on outreach_conversations (status);
create index if not exists outreach_activity_session_done_at_idx on outreach_activity (session, done_at);

-- Доступ только через service role (сервер), как и у shipments — без публичной policy.
alter table outreach_accounts enable row level security;
alter table outreach_contacts enable row level security;
alter table outreach_messages enable row level security;
alter table outreach_conversations enable row level security;
alter table outreach_activity enable row level security;
