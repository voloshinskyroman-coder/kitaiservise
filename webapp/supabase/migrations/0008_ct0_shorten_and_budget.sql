-- Ветка "полный цикл поставки" (clientType 0) сокращена — товар/поставщик ещё не найден,
-- поэтому вес/объём/стоимость/готовность там не спрашиваются. Добавляем бюджет на закупку.
alter table shipments
  add column if not exists purchase_budget numeric;
