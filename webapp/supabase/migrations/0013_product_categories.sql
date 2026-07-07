-- Google Product Taxonomy (ru-RU, официальный бесплатный источник Google для Google Shopping) —
-- используется для автодополнения в поле "Что хотите привезти?" (см. tn.md, шаг 1).
create table if not exists product_categories (
  id text primary key,
  path text not null,
  leaf_name text not null
);

create index if not exists product_categories_leaf_idx on product_categories (lower(leaf_name) text_pattern_ops);
