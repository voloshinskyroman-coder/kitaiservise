-- Sentiment раньше считался один раз и кэшировался навсегда (sentiment=is.null
-- в выборке кандидатов) — если переписка продолжалась после первой оценки,
-- статус в админке не обновлялся. sentiment_msg_count хранит, сколько
-- сообщений (в обе стороны) было учтено в последней оценке; sync_reply_sentiment
-- в sync_to_supabase.py сравнивает его с реальным количеством сообщений и
-- пересчитывает, если появились новые.

alter table outreach_contacts add column if not exists sentiment_msg_count integer not null default 0;
