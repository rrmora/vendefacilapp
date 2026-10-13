CREATE OR REPLACE FUNCTION release_quota(p_reservation_id UUID) RETURNS JSON AS $$
DECLARE
  v_visitor_id UUID;
  v_status VARCHAR(20);
  v_quota_date DATE;
BEGIN
  SELECT visitor_id, status, (created_at AT TIME ZONE 'America/Mexico_City')::DATE
  INTO v_visitor_id, v_status, v_quota_date
  FROM quota_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN json_build_object('status', 'already_processed', 'previous_status', v_status);
  END IF;

  UPDATE quota_reservations
  SET status = 'released', completed_at = NOW()
  WHERE reservation_id = p_reservation_id;

  UPDATE visitor_daily_quota
  SET generations_used = GREATEST(generations_used - 1, 0), updated_at = NOW()
  WHERE visitor_id = v_visitor_id AND quota_date = v_quota_date;

  RETURN json_build_object('status', 'released');
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION release_quota(UUID) FROM PUBLIC;
