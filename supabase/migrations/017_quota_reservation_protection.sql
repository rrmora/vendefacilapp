-- T-004-7, Part B: proteccion persistente minima de reservas de cuota
-- antes de enviar una solicitud a IA.

ALTER TABLE IF EXISTS public.quota_reservations
  DROP CONSTRAINT IF EXISTS quota_reservations_status_check;

ALTER TABLE IF EXISTS public.quota_reservations
  ADD CONSTRAINT quota_reservations_status_check
  CHECK (status IN ('pending', 'sent_uncertain', 'completed', 'released', 'expired'));

COMMENT ON COLUMN public.quota_reservations.status IS
  'pending: reservada; sent_uncertain: enviada a IA sin confirmacion persistente; completed: exitosa; released: fallo seguro; expired: expiro sin liberar.';

CREATE OR REPLACE FUNCTION public.mark_quota_sent(p_reservation_id UUID)
RETURNS JSON AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  SELECT status
  INTO v_status
  FROM public.quota_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status = 'sent_uncertain' THEN
    RETURN json_build_object('status', 'already_sent', 'previous_status', v_status);
  END IF;

  IF v_status <> 'pending' THEN
    RETURN json_build_object('status', 'already_processed', 'previous_status', v_status);
  END IF;

  UPDATE public.quota_reservations
  SET status = 'sent_uncertain'
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object('status', 'sent', 'previous_status', v_status);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.confirm_quota(p_reservation_id UUID) RETURNS JSON AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  SELECT status INTO v_status
  FROM public.quota_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status NOT IN ('pending', 'sent_uncertain') THEN
    RETURN json_build_object('status', 'already_processed', 'previous_status', v_status);
  END IF;

  UPDATE public.quota_reservations
  SET status = 'completed', completed_at = NOW()
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object('status', 'confirmed');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.release_quota(p_reservation_id UUID) RETURNS JSON AS $$
DECLARE
  v_visitor_id UUID;
  v_status VARCHAR(20);
  v_quota_date DATE;
BEGIN
  SELECT visitor_id, status, (created_at AT TIME ZONE 'America/Mexico_City')::DATE
  INTO v_visitor_id, v_status, v_quota_date
  FROM public.quota_reservations
  WHERE reservation_id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN json_build_object('status', 'not_found');
  END IF;

  IF v_status NOT IN ('pending', 'sent_uncertain') THEN
    RETURN json_build_object('status', 'already_processed', 'previous_status', v_status);
  END IF;

  UPDATE public.quota_reservations
  SET status = 'released', completed_at = NOW()
  WHERE reservation_id = p_reservation_id;

  UPDATE public.visitor_daily_quota
  SET generations_used = GREATEST(generations_used - 1, 0)
  WHERE visitor_id = v_visitor_id AND quota_date = v_quota_date;

  RETURN json_build_object('status', 'released');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.expire_pending_reservations() RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  -- Proteger reservas asociadas a una generacion exitosa.
  UPDATE public.quota_reservations r
  SET status = 'completed', completed_at = NOW()
  WHERE r.status IN ('pending', 'sent_uncertain')
    AND r.expires_at < NOW()
    AND EXISTS (
      SELECT 1
      FROM public.generation_records g
      WHERE g.reservation_id = r.reservation_id
        AND g.success = TRUE
    );

  -- Las reservas sent_uncertain nunca se liberan automaticamente porque
  -- su consumo es incierto. Solo se expira la excepcion pendiente inicial.
  WITH expired AS (
    UPDATE public.quota_reservations
    SET status = 'expired', completed_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW()
    RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
  ),
  quota_adjusted AS (
    UPDATE public.visitor_daily_quota q
    SET generations_used = GREATEST(q.generations_used - 1, 0)
    FROM expired e
    WHERE q.visitor_id = e.visitor_id AND q.quota_date = e.quota_date
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_quota(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_quota(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mark_quota_sent(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.confirm_quota(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_quota(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role';
  END IF;
END $$;
