-- Рабочий статус для логиста в админке (отдельно от status квиза in_progress/completed).
alter table shipments
  add column if not exists logist_status text not null default 'new'
  check (logist_status in ('new', 'contacted', 'closed'));

create index if not exists shipments_logist_status_idx on shipments (logist_status);
