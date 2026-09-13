-- PROPOSAL ONLY. Additive, synthetic local rehearsal; no backfill/mobile ingestion.
-- Reuse the existing canonical queue/generation/lease and bounded old+new 28d invalidation.
-- Raw body writes and their queue invalidation commit atomically.
create trigger engine_manual_body_dirty after insert or update of revision
  on public.engine_manual_body_records for each row execute function private.engine_enqueue_meal();
