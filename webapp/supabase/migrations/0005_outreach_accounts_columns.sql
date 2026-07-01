-- outreach_accounts уже существовала в базе (создана раньше по схеме vellarhome), поэтому
-- 0003_outreach.sql молча пропустил CREATE TABLE. Добавляем недостающие колонки, на которые
-- опирается логика тиров прогрева (getAccountTier) в /admin/outreach.
alter table outreach_accounts add column if not exists flood_count integer default 0;
alter table outreach_accounts add column if not exists name text;
alter table outreach_accounts add column if not exists avatar_url text;
alter table outreach_accounts add column if not exists created_at timestamptz default now();
