-- AI-анализ товара (tn.md): уровень уверенности + предложенные документы/сертификаты,
-- используются для предзаполнения чек-листов в квизе (логист может изменить выбор).
alter table shipments
  add column if not exists ai_confidence numeric,
  add column if not exists ai_suggested_documents text[] not null default '{}',
  add column if not exists ai_suggested_non_tariff text[] not null default '{}';
