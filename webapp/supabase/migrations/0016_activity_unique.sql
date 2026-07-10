-- outreach_activity.id is an identity column — the sync script can't set it
-- explicitly, so every insert has been silently failing with 400 since the
-- table was created. Add a natural key so the sync can upsert without
-- touching id.
alter table outreach_activity
  add constraint outreach_activity_natural_key unique (session, type, done_at);
