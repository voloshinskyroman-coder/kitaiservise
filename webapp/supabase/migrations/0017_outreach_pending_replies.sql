-- Очередь ответов оператора из админки. Апи-роут кладёт сюда сообщение,
-- sync_to_supabase.py (на сервере рассылки) забирает необработанные раз
-- в ~20с и ставит в локальную pending_operator_sends — оттуда демон
-- отправляет через живую Telethon-сессию. Прямой отправки в Telegram
-- с Vercel нет и не будет — только сервер рассылки держит сессии аккаунтов.

create table if not exists outreach_pending_replies (
  id         bigint generated always as identity primary key,
  contact_id bigint not null,
  account_id bigint not null,
  text       text not null,
  processed  boolean default false,
  created_at timestamptz default now()
);

create index if not exists outreach_pending_replies_unprocessed_idx
  on outreach_pending_replies (processed) where processed = false;

alter table outreach_pending_replies enable row level security;

create policy "service_all" on outreach_pending_replies for all using (true);
