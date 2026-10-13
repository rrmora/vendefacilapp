CREATE OR REPLACE FUNCTION reconcile_pending_budget_reservations(
  p_max_age INTERVAL DEFAULT INTERVAL '15 minutes'
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH stale AS (
    SELECT reservation_id, budget_month, reserved_cost_usd
    FROM budget_reservations
    WHERE status = 'reserved'
      AND created_at < NOW() - p_max_age
    FOR UPDATE
  )
  UPDATE budget_tracking t
  SET spent_usd = t.spent_usd + COALESCE(s.reserved_cost_usd, 0),
      reserved_usd = GREATEST(t.reserved_usd - COALESCE(s.reserved_cost_usd, 0), 0),
      updated_at = NOW()
  FROM stale s
  WHERE t.month = s.budget_month;

  WITH stale AS (
    SELECT reservation_id
    FROM budget_reservations
    WHERE status = 'reserved'
      AND created_at < NOW() - p_max_age
  )
  UPDATE budget_reservations b
  SET status = 'confirmed',
      actual_cost_usd = b.reserved_cost_usd,
      cost_estimated = TRUE,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE b.reservation_id IN (SELECT reservation_id FROM stale);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION reconcile_pending_budget_reservations(INTERVAL) FROM PUBLIC;