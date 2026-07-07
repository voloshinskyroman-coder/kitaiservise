-- Официальный классификатор ТН ВЭД ЕАЭС (источник: ФНС России, data.nalog.ru/files/tnved/tnved.zip,
-- действующие коды на 27.04.2026) — используется, чтобы сверять/корректировать AI-гипотезу
-- о коде товара, а не доверять придуманному моделью коду вслепую (см. tn.md).
create table if not exists hs_codes (
  code text primary key,
  description text not null,
  chapter text not null,
  search_vector tsvector generated always as (to_tsvector('russian', description)) stored
);

create index if not exists hs_codes_search_idx on hs_codes using gin (search_vector);
create index if not exists hs_codes_chapter_idx on hs_codes (chapter);

alter table shipments
  add column if not exists hs_code_suggested_description text;
