-- Read-only export of the minimum audit fields for an offline Jeffreys replay.
-- Fixed lookback: 180 days (90-day baseline warm-up + calibration + holdout).
-- If this range does not provide enough observations, report that limitation;
-- do not widen the range automatically.
SELECT
  user_id,
  action,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  status
FROM public.audit_logs
WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '180 days'
  AND created_at < CURRENT_TIMESTAMP
ORDER BY created_at ASC, user_id ASC NULLS FIRST, action ASC, status ASC;
