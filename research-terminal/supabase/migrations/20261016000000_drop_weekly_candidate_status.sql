-- jarvis_weekly_candidates.status was never written by the application: it always
-- stayed at its default ('new') while the real position lifecycle lived on
-- jarvis_weekly_actions. Its enum overlapped confusingly with the lifecycle flags,
-- so it was a trap for anyone reading it.
--
-- Position status is now derived from ONE source of truth
-- (jarvis_weekly_actions.action / invalidated / target_reached) through
-- lib/weekly-lifecycle.ts and exposed as a `status` field by the read APIs.
-- Remove the misleading column.

alter table public.jarvis_weekly_candidates drop column if exists status;
