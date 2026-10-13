CREATE OR REPLACE FUNCTION get_quota_status(
  p_visitor_id UUID,
  p_quota_date DATE
) RETURNS JSON AS $$
DECLARE
  v_generations_used INTEGER;
  v_max_generations INTEGER;
  v_pending_count INTEGER;
BEGIN
  SELECT generations_used, max_generations
  INTO v_generations_used, v_max_generations
  FROM visitor_daily_quota
  WHERE visitor_id = p_visitor_id AND quota_date = p_quota_date;

  SELECT COUNT(*)
  INTO v_pending_count
  FROM quota_reservations
  WHERE visitor_id = p_visitor_id AND status = 'pending';

  RETURN json_build_object(
    'visitor_id', p_visitor_id,
    'quota_date', p_quota_date,
    'generations_used', COALESCE(v_generations_used, 0),
    'max_generations', COALESCE(v_max_generations, 5),
    'pending_reservations', COALESCE(v_pending_count, 0),
    'remaining', GREATEST(COALESCE(v_max_generations, 5) - COALESCE(v_generations_used, 0) - COALESCE(v_pending_count, 0), 0)
  );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION get_quota_status(UUID, DATE) FROM PUBLIC;
