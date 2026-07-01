-- Статус карточки в CRM-канбане для контактов, пришедших из рассылки (outreach_contacts.status
-- принадлежит демону рассылки — new/sent/replied/skipped/failed — и не должен переиспользоваться
-- под пайплайн менеджера, поэтому заводим отдельное поле с теми же 3 статусами, что и у shipments.
alter table outreach_contacts
  add column if not exists crm_status text not null default 'new'
  check (crm_status in ('new', 'contacted', 'closed'));
