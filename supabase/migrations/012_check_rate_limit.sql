CREATE OR REPLACE FUNCTION check_rate_limit(p_ip_address INET) RETURNS JSON AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_minute_start TIMESTAMPTZ := date_trunc('minute', v_now);
  v_hour_start TIMESTAMPTZ := date_trunc('hour', v_now);
  v_day_start TIMESTAMPTZ := date_trunc('day', v_now);
  v_minute_count INTEGER;
  v_hour_count INTEGER;
  v_day_count INTEGER;
  v_retry_seconds INTEGER;
BEGIN
  DELETE FROM ip_rate_limits
  WHERE window_start < v_now - INTERVAL '24 hours';

  INSERT INTO ip_rate_limits (ip_address, window_start, request_count)
  VALUES (p_ip_address, v_minute_start, 0)
  ON CONFLICT (ip_address, window_start) DO NOTHING;

  SELECT request_count
  INTO v_minute_count
  FROM ip_rate_limits
  WHERE ip_address = p_ip_address AND window_start = v_minute_start
  FOR UPDATE;

  IF v_minute_count IS NULL THEN
    v_minute_count := 0;
  END IF;

  IF v_minute_count + 1 > 10 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_minute_start + INTERVAL '1 minute' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'minute',
      'limit', 10,
      'current', v_minute_count,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  INSERT INTO ip_rate_limits (ip_address, window_start, request_count)
  VALUES (p_ip_address, v_hour_start, 0)
  ON CONFLICT (ip_address, window_start) DO NOTHING;

  SELECT request_count
  INTO v_hour_count
  FROM ip_rate_limits
  WHERE ip_address = p_ip_address AND window_start = v_hour_start
  FOR UPDATE;

  IF v_hour_count IS NULL THEN
    v_hour_count := 0;
  END IF;

  IF v_hour_count + 1 > 100 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_hour_start + INTERVAL '1 hour' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'hour',
      'limit', 100,
      'current', v_hour_count,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  INSERT INTO ip_rate_limits (ip_address, window_start, request_count)
  VALUES (p_ip_address, v_day_start, 0)
  ON CONFLICT (ip_address, window_start) DO NOTHING;

  SELECT request_count
  INTO v_day_count
  FROM ip_rate_limits
  WHERE ip_address = p_ip_address AND window_start = v_day_start
  FOR UPDATE;

  IF v_day_count IS NULL THEN
    v_day_count := 0;
  END IF;

  IF v_day_count + 1 > 500 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_day_start + INTERVAL '1 day' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'day',
      'limit', 500,
      'current', v_day_count,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  UPDATE ip_rate_limits
  SET request_count = request_count + 1
  WHERE ip_address = p_ip_address AND window_start = v_minute_start;

  UPDATE ip_rate_limits
  SET request_count = request_count + 1
  WHERE ip_address = p_ip_address AND window_start = v_hour_start;

  UPDATE ip_rate_limits
  SET request_count = request_count + 1
  WHERE ip_address = p_ip_address AND window_start = v_day_start;

  RETURN json_build_object(
    'status', 'allowed',
    'counts', json_build_object(
      'minute', v_minute_count + 1,
      'hour', v_hour_count + 1,
      'day', v_day_count + 1
    ),
    'limits', json_build_object(
      'minute', 10,
      'hour', 100,
      'day', 500
    )
  );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION check_rate_limit(INET) FROM PUBLIC;