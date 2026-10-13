CREATE OR REPLACE FUNCTION reserve_quota(
  p_visitor_id UUID,
  p_quota_date DATE,
  p_reservation_id UUID
) RETURNS JSON AS $$
DECLARE
  v_pending_count INTEGER;
  v_generations_used INTEGER;
  v_max_generations INTEGER;
BEGIN
  INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
  VALUES (p_visitor_id, p_quota_date, 0, 5)
  ON CONFLICT (visitor_id, quota_date) DO NOTHING;

  SELECT generations_used, max_generations
  INTO v_generations_used, v_max_generations
  FROM visitor_daily_quota
  WHERE visitor_id = p_visitor_id AND quota_date = p_quota_date
  FOR UPDATE;

  IF v_generations_used >= v_max_generations THEN
    RETURN json_build_object('status', 'quota_exceeded', 'generations_used', v_generations_used, 'max_generations', v_max_generations);
  END IF;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM quota_reservations
  WHERE visitor_id = p_visitor_id AND status = 'pending';

  IF v_pending_count >= 3 THEN
    RETURN json_build_object('status', 'rate_limited', 'pending_count', v_pending_count);
  END IF;

  UPDATE visitor_daily_quota
  SET generations_used = generations_used + 1, updated_at = NOW()
  WHERE visitor_id = p_visitor_id AND quota_date = p_quota_date;

  INSERT INTO quota_reservations (visitor_id, reservation_id, status, expires_at)
  VALUES (p_visitor_id, p_reservation_id, 'pending', NOW() + INTERVAL '5 minutes');

  RETURN json_build_object('status', 'reserved', 'generations_used', v_generations_used + 1, 'max_generations', v_max_generations);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION reserve_quota(UUID, DATE, UUID) FROM PUBLIC;
