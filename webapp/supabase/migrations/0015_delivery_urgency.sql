-- Насколько срочно нужна доставка груза (в днях в пути) — отдельно от готовности груза
-- к отправке (cargo_readiness).
alter table shipments
  add column if not exists delivery_urgency text;
