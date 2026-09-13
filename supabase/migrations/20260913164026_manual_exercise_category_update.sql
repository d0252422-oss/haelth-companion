-- Release B only; existing model already has muscle_group. No new table or cascades.
-- Backend requires verified owner, canonical advisory lock and preference revision.
grant update(muscle_group) on public.manual_exercise_catalog to service_role;
