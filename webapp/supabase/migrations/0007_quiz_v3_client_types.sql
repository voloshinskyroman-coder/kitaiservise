-- Новые поля под квиз с 4 clientType (полный цикл / нашёл товар / уже куплен / отдельные услуги).
alter table shipments
  add column if not exists client_type smallint check (client_type in (0, 1, 2, 3)),
  add column if not exists prior_experience text check (prior_experience in ('white', 'cargo', 'none')),
  add column if not exists product_reference_type text,
  add column if not exists product_reference_value text,
  add column if not exists product_location text,
  add column if not exists destination_type text check (destination_type in ('city', 'warehouse', 'door', 'not_needed')),
  add column if not exists payment_method text,
  add column if not exists needs_supplier_search boolean,
  add column if not exists needs_supplier_check text check (needs_supplier_check in ('yes', 'no', 'unknown')),
  add column if not exists package_type text check (package_type in ('boxes', 'pallets', 'bags', 'other')),
  add column if not exists needs_logistics_calc boolean,
  add column if not exists customs_contract_holder text check (customs_contract_holder in ('us', 'client', 'unknown')),
  add column if not exists logistics_method text,
  add column if not exists separate_services text[] not null default '{}',
  add column if not exists non_tariff_services text[] not null default '{}';

alter table shipments drop constraint if exists shipments_delivery_mode_check;
alter table shipments add constraint shipments_delivery_mode_check check (delivery_mode in ('cargo', 'white', 'docs_only'));
