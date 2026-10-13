CREATE OR REPLACE FUNCTION confirm_quota(p_reservation_id UUID) RETURNS JSON AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  SELECT status INTO v_status
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
  SET status = 'completed', completed_at = NOW()
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object('status', 'confirmed');
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION confirm_quota(UUID) FROM PUBLIC;
