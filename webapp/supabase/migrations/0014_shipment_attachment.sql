-- Вложение (инвойс/упаковочный лист) к заявке — файл лежит в приватном Storage-бакете
-- shipment-documents (создан отдельно через supabase.storage.createBucket), здесь только путь.
alter table shipments
  add column if not exists attachment_path text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_ai_summary text;
