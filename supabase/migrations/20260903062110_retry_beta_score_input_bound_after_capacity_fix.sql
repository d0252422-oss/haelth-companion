-- Retry only the Beta dates that hit the previous 5,000-row transport guard.
-- The scoring formula is unchanged; the Edge reader now has a 20,000-row hard cap.
update private.beta_score_recompute_queue
   set status = 'DIRTY', attempt_count = 0, next_attempt_at = now(),
       lease_token = null, lease_expires_at = null, last_error_code = null,
       updated_at = now()
 where status = 'FAILED' and last_error_code = 'SCORE_INPUT_BOUND_EXCEEDED';
