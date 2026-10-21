-- T-004-8.3: limpieza global de eventos antiguos de rate limiting.
--
-- Causa raiz: check_rate_limit elimina los eventos vencidos solo de la IP que
-- vuelve a solicitar. Las IPs que no regresan dejan sus eventos en
-- ip_rate_limit_events indefinidamente y la tabla crece sin limite.
--
-- Retencion: 25 horas. Las ventanas maximas son 60 s, 3600 s y 86400 s (24 h).
-- Se conserva una hora de margen sobre la ventana de 24 h para cubrir desfases
-- de reloj entre la limpieza y check_rate_limit. La retencion minima aceptada
-- es 25 horas para que ninguna llamada pueda borrar eventos que la ventana de
-- 24 h todavia necesita.
--
-- Eliminacion por lotes: cada DELETE procesa como maximo p_batch_size filas
-- elegibles con FOR UPDATE SKIP LOCKED y el bucle continua hasta que no quedan
-- eventos. La funcion se ejecuta en una sola transaccion (RPC), por lo que el
-- lote acota el trabajo y los bloqueos por sentencia, no el tamano total de la
-- transaccion. Un borrado en multiples transacciones requeriria un
-- procedimiento con COMMIT o el scheduler de T-004-8.8, fuera de este alcance.
--
-- Concurrencia: pg_try_advisory_xact_lock evita que dos limpiezas globales
-- dupliquen trabajo; si otra esta activa, la llamada retorna 0. SKIP LOCKED
-- evita esperar por filas bloqueadas por check_rate_limit u otra limpieza.
--
-- No se modifica check_rate_limit: conserva limites, respuesta JSON, ventanas
-- y la limpieza acotada por IP.

-- Indice para el barrido global por antiguedad. El indice existente
-- (ip_address, accepted_at DESC) no sirve para filtrar solo por accepted_at.
CREATE INDEX IF NOT EXISTS idx_ip_rate_events_accepted_at_id
  ON public.ip_rate_limit_events (accepted_at, id);

CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_events(
  p_retention INTERVAL DEFAULT INTERVAL '25 hours',
  p_batch_size INTEGER DEFAULT 1000
) RETURNS INTEGER AS $$
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
  -- esta llamada no duplica trabajo y es idempotente.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('public.cleanup_rate_limit_events', 0)
  ) THEN
    RETURN 0;
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

  RETURN v_total;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) IS
  'Elimina globalmente los eventos de ip_rate_limit_events con mas de p_retention '
  '(minimo 25 horas) en lotes de p_batch_size. Idempotente y segura ante ejecuciones '
  'concurrentes: usa un advisory lock y FOR UPDATE SKIP LOCKED. Retorna el total eliminado.';

REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) TO service_role';
  END IF;
END $$;
