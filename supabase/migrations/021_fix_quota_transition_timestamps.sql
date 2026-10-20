-- T-004-8.2b: corrige los timestamps de transicion de las reservas de cuota.
--
-- Causa raiz: las RPC de cuota usan NOW() para completed_at y para evaluar la
-- expiracion. NOW() es el inicio de la transaccion, no el instante de la
-- instruccion. Una transaccion larga que actualiza filas creadas por
-- otras transacciones puede escribir un completed_at anterior al created_at y
-- violar chk_completed_after_created. El mismo NOW() tampoco ve como vencidas
-- las reservas que expiraron mientras la transaccion estaba abierta.
--
-- Correccion:
--   - confirm_quota y release_quota escriben completed_at con
--     GREATEST(clock_timestamp(), created_at) despues de bloquear la fila con
--     FOR UPDATE. El GREATEST es una red de seguridad: si el reloj de pared
--     retrocede (por ejemplo, resincronizacion de hora del contenedor),
--     clock_timestamp() podria quedar antes que el created_at de una fila
--     creada durante el salto y violar chk_completed_after_created.
--   - expire_pending_reservations captura v_now := clock_timestamp() una sola
--     vez y lo usa para decidir la expiracion y para completed_at. Como
--     chk_expires_after_created garantiza expires_at > created_at, toda fila
--     con expires_at < v_now cumple created_at < v_now, de modo que
--     completed_at nunca queda antes de created_at, incluso bajo concurrencia.
--     GREATEST(v_now, created_at) deja esa garantia explicita.
--
-- No cambian firmas, retornos, estados, idempotencia ni la proteccion de
-- sent_uncertain. No se toca NOW() en created_at ni en expires_at (dentro de
-- reserve_quota): ahi el instante consistente de la transaccion es
-- intencional. La migracion 020 ya usa clock_timestamp() para el presupuesto.

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
  SET status = 'completed', completed_at = GREATEST(clock_timestamp(), created_at)
  WHERE reservation_id = p_reservation_id;

  RETURN json_build_object('status', 'confirmed');
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.confirm_quota(UUID) IS
  'Confirma una reserva pending o sent_uncertain. Idempotente: una reserva ya procesada '
  'retorna already_processed. completed_at usa clock_timestamp() acotado por created_at.';

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
  SET status = 'released', completed_at = GREATEST(clock_timestamp(), created_at)
  WHERE reservation_id = p_reservation_id;

  UPDATE public.visitor_daily_quota
  SET generations_used = GREATEST(generations_used - 1, 0),
      updated_at = clock_timestamp()
  WHERE visitor_id = v_visitor_id AND quota_date = v_quota_date;

  RETURN json_build_object('status', 'released');
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.release_quota(UUID) IS
  'Libera una reserva pending o sent_uncertain y decrementa la cuota del dia original. '
  'Idempotente. completed_at usa clock_timestamp() acotado por created_at.';

CREATE OR REPLACE FUNCTION public.expire_pending_reservations() RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER;
  v_now TIMESTAMPTZ;
BEGIN
  -- Reloj de ejecucion capturado una sola vez. Se usa tanto para decidir la
  -- expiracion como para completed_at: toda fila elegible cumple
  -- created_at < expires_at < v_now, y GREATEST(v_now, created_at) = v_now.
  v_now := clock_timestamp();

  -- Proteger reservas asociadas a una generacion exitosa.
  UPDATE public.quota_reservations r
  SET status = 'completed', completed_at = GREATEST(v_now, created_at)
  WHERE r.status IN ('pending', 'sent_uncertain')
    AND r.expires_at < v_now
    AND EXISTS (
      SELECT 1
      FROM public.generation_records g
      WHERE g.reservation_id = r.reservation_id
        AND g.success = TRUE
    );

  -- Expirar solo reservas pending. Las sent_uncertain quedan intactas porque su
  -- consumo es incierto.
  WITH expired AS (
    UPDATE public.quota_reservations
    SET status = 'expired', completed_at = GREATEST(v_now, created_at)
    WHERE status = 'pending' AND expires_at < v_now
    RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
  ),
  released AS (
    -- Agrupar por visitante y fecha: sin este GROUP BY, UPDATE ... FROM aplicaria
    -- una sola vez por fila de quota.
    SELECT visitor_id, quota_date, COUNT(*)::INTEGER AS units
    FROM expired
    GROUP BY visitor_id, quota_date
  ),
  quota_adjusted AS (
    UPDATE public.visitor_daily_quota q
    SET generations_used = GREATEST(q.generations_used - r.units, 0), updated_at = v_now
    FROM released r
    WHERE q.visitor_id = r.visitor_id AND q.quota_date = r.quota_date
  )
  SELECT COUNT(*) INTO v_expired_count FROM expired;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.expire_pending_reservations() IS
  'Expira reservas pending vencidas y libera la cuota agrupada por visitor_id y quota_date. '
  'Nunca libera sent_uncertain; completa de forma conservadora las inciertas con '
  'generation_records.success = TRUE. Usa clock_timestamp() para decidir la expiracion y '
  'para completed_at, por lo que funciona dentro de transacciones largas sin violar '
  'chk_completed_after_created. Retorna el numero de reservas expiradas.';

REVOKE EXECUTE ON FUNCTION public.confirm_quota(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_quota(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_quota(UUID) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.release_quota(UUID) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_quota(UUID) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.release_quota(UUID) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.confirm_quota(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_quota(UUID) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role';
  END IF;
END $$;
