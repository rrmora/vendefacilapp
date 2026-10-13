CREATE OR REPLACE FUNCTION expire_pending_reservations() RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE quota_reservations
    SET status = 'expired', completed_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW()
    RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
  ),
  quota_adjusted AS (
    UPDATE visitor_daily_quota q
    SET generations_used = GREATEST(q.generations_used - 1, 0), updated_at = NOW()
    FROM expired e
    WHERE q.visitor_id = e.visitor_id AND q.quota_date = e.quota_date
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION expire_pending_reservations() FROM PUBLIC;
