-- T-004-8.1: corrige el decremento de cuota al expirar varias reservas del
-- mismo visitante y fecha.
--
-- Causa raiz: la version vigente (017) liberaba cuota con
--   UPDATE visitor_daily_quota q ... FROM expired e
-- En PostgreSQL, cuando varias filas de la fuente coinciden con la misma fila
-- destino, solo se aplica una actualizacion: un lote de N reservas vencidas del
-- mismo visitante y fecha liberaba una sola unidad de cuota.
--
-- Correccion: se agrupan las reservas expiradas por (visitor_id, quota_date) y
-- se resta el conteo. Firma (sin parametros) y retorno INTEGER se conservan.
--
-- Se mantienen sin cambios:
--   - las reservas sent_uncertain nunca se liberan automaticamente;
--   - las reservas pending o sent_uncertain con generation_records.success = TRUE
--     se marcan completed de forma conservadora sin decrementar cuota;
--   - la quota_date se deriva de created_at en America/Mexico_City, de modo que
--     se libera la cuota del dia original aunque la operacion ocurra despues.

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

  -- Expirar solo reservas pending. Las sent_uncertain quedan intactas porque su
  -- consumo es incierto.
  WITH expired AS (
    UPDATE public.quota_reservations
    SET status = 'expired', completed_at = NOW()
    WHERE status = 'pending' AND expires_at < NOW()
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
    SET generations_used = GREATEST(q.generations_used - r.units, 0), updated_at = NOW()
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
  'Nunca libera sent_uncertain; completa de forma conservadora las inciertas con generation_records.success = TRUE. '
  'Retorna el numero de reservas expiradas.';

REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role';
  END IF;
END $$;