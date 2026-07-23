-- Добавляет "Пропустить" в очередь ответов оператора: action='skip' просто
-- закрывает диалог без отправки сообщения клиенту (action='send' — прежнее
-- поведение). text обязателен только для send.

alter table outreach_pending_replies
  add column if not exists action text not null default 'send';

alter table outreach_pending_replies
  alter column text drop not null;

alter table outreach_pending_replies
  add constraint outreach_pending_replies_action_check
  check (action in ('send', 'skip'));
