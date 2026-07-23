-- LLM-классификация тональности ответа (весь контекст диалога, не только
-- последнее сообщение) — считается один раз на сервере рассылки и кэшируется
-- здесь. См. bots/outreach/sync_to_supabase.py::sync_reply_sentiment().

alter table outreach_contacts add column if not exists sentiment text;
alter table outreach_contacts add column if not exists sentiment_reason text;
