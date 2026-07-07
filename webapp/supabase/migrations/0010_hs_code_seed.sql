-- Задел под будущее автоопределение ТН ВЭД (tn.md): пока логист вписывает код вручную
-- после подтверждения заявки — так с первого дня начинает копиться внутренняя база знаний.
alter table shipments
  add column if not exists hs_code_suggested text,
  add column if not exists hs_code_confirmed text;
