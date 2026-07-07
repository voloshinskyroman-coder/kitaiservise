-- Срочность и свободный комментарий клиента (пока только в ветке clientType 0).
alter table shipments
  add column if not exists urgency text check (urgency in ('urgent', 'month', 'not_urgent')),
  add column if not exists client_comment text;
