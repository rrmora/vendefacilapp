-- T-004-8.5 (A): desambigua la limpieza global de eventos de rate limit.
--
-- La version vigente (022) retornaba INTEGER 0 tanto cuando no habia filas
-- elegibles como cuando otra limpieza mantenia el advisory lock. run_maintenance
-- necesita distinguir ambos casos para no contabilizar como completada una tarea
-- omitida por concurrencia.
--
-- Se extrae la logica comun a public.cleanup_rate_limit_events_core, que adquiere
-- el advisory lock una sola vez por ejecucion efectiva y retorna JSONB:
--   {"status":"completed","deleted":N}
--   {"status":"already_running","deleted":0}
--
-- public.cleanup_rate_limit_events conserva firma, retorno INTEGER, validaciones
-- y semantica de consumidores: retorna el total eliminado, o 0 si la limpieza fue
-- omitida. public.cleanup_rate_limit_events_status expone el diagnostico JSONB.

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_events_core(
  p_retention INTERVAL DEFAULT INTERVAL '25 hours',
  p_batch_size INTEGER DEFAULT 1000
) RETURNS JSONB AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_deleted INTEGER;
  v_total INTEGER := 0;
BEGIN
  IF p_retention IS NULL OR p_retention < INTERVAL '25 hours' THEN
    RAISE EXCEPTION 'La retencion minima de cleanup_rate_limit_events es 25 horas';
  END IF;

  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'p_batch_size debe ser mayor o igual a 1';
  END IF;

  -- Solo una limpieza global a la vez. Si otra transaccion la esta ejecutando,
  -- esta llamada no duplica trabajo y reporta el motivo de la omision.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('public.cleanup_rate_limit_events', 0)
  ) THEN
    RETURN jsonb_build_object('status', 'already_running', 'deleted', 0);
  END IF;

  v_cutoff := clock_timestamp() - p_retention;

  LOOP
    WITH batch AS (
      SELECT id
      FROM public.ip_rate_limit_events
      WHERE accepted_at < v_cutoff
      ORDER BY accepted_at, id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.ip_rate_limit_events e
    USING batch b
    WHERE e.id = b.id;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total := v_total + v_deleted;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  RETURN jsonb_build_object('status', 'completed', 'deleted', v_total);
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) IS
  'Nucleo interno compartido de limpieza global. Adquiere el advisory lock una sola vez y '
  'retorna {status: completed|already_running, deleted: N}. No exponer a clientes.';

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_events(
  p_retention INTERVAL DEFAULT INTERVAL '25 hours',
  p_batch_size INTEGER DEFAULT 1000
) RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (public.cleanup_rate_limit_events_core(p_retention, p_batch_size) ->> 'deleted')::INTEGER,
    0
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) IS
  'Elimina globalmente los eventos de ip_rate_limit_events con mas de p_retention '
  '(minimo 25 horas) en lotes de p_batch_size. Retorna el total eliminado o 0 si otra '
  'limpieza mantiene el advisory lock. Idempotente.';

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_events_status(
  p_retention INTERVAL DEFAULT INTERVAL '25 hours',
  p_batch_size INTEGER DEFAULT 1000
) RETURNS JSONB AS $$
BEGIN
  RETURN public.cleanup_rate_limit_events_core(p_retention, p_batch_size);
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_rate_limit_events_status(INTERVAL, INTEGER) IS
  'Variante diagnostica de cleanup_rate_limit_events. Retorna {status: completed, deleted: N} '
  'o {status: already_running, deleted: 0} para distinguir una limpieza omitida por concurrencia.';

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_status(INTERVAL, INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_status(INTERVAL, INTEGER) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events_status(INTERVAL, INTEGER) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_events_status(INTERVAL, INTEGER) TO service_role';
  END IF;
END $$;
