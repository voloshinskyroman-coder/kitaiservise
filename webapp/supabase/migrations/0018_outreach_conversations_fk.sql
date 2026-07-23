-- outreach_conversations.contact_id ссылается на outreach_contacts(id) в 0003_outreach.sql,
-- но реального FK в базе не оказалось (таблица, похоже, была создана до миграции —
-- "create table if not exists" не добавляет constraint к уже существующей таблице).
-- Из-за этого PostgREST не мог сделать embed outreach_contacts(...) в запросе диалогов
-- на дашборде — весь блок "Открытые диалоги" всегда возвращал пустой список.

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'outreach_conversations_contact_id_fkey'
      and table_name = 'outreach_conversations'
  ) then
    alter table outreach_conversations
      add constraint outreach_conversations_contact_id_fkey
      foreign key (contact_id) references outreach_contacts (id);
  end if;
end $$;
