-- T-004-7A: rate limiting con ventana movil real.
--
-- Reemplaza la semantica de cubetas fijas de calendario (migracion 012) por
-- ventanas moviles exactas sobre un registro de solicitudes ACEPTADAS.
-- Las migraciones 005 y 012 NO se modifican; la tabla ip_rate_limits se
-- conserva sin escritores.
--
-- Semantica: para una solicitud evaluada en el instante t, la ventana es
-- (t - W, t] (abierta a la izquierda, cerrada a la derecha). Se acepta si las
-- aceptadas dentro de la ventana son menores al limite; en caso contrario se
-- rechaza. Las solicitudes rechazadas no se registran.
--
-- Invariante: en todo instante, cualquier intervalo de 60 segundos contiene
-- como maximo 10 solicitudes aceptadas de una misma IP.

CREATE TABLE IF NOT EXISTS public.ip_rate_limit_events (
  id BIGSERIAL PRIMARY KEY,
  ip_address INET NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL
);

COMMENT ON COLUMN public.ip_rate_limit_events.accepted_at IS
  'Instante de aceptacion capturado por la RPC con clock_timestamp() despues de adquirir el bloqueo por IP.';

CREATE INDEX IF NOT EXISTS idx_ip_rate_events
  ON public.ip_rate_limit_events (ip_address, accepted_at DESC);

ALTER TABLE public.ip_rate_limit_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ip_rate_limit_events IS
  'Solicitudes aceptadas por IP (ventana movil). RLS activo: solo el servidor (service_role) puede operar. '
  'La limpieza global de eventos con mas de 24 horas requiere el job de limpieza pendiente.';

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_ip_address INET)
RETURNS JSON AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_minute INTEGER;
  v_hour INTEGER;
  v_day INTEGER;
  v_oldest_minute TIMESTAMPTZ;
  v_oldest_hour TIMESTAMPTZ;
  v_oldest_day TIMESTAMPTZ;
  v_retry_seconds INTEGER;
BEGIN
  -- Serializa las decisiones por IP dentro de la transaccion. Se libera solo al
  -- confirmar, deshacer o lanzar excepcion, tambien en el camino fail-closed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_ip_address::TEXT, 0)
  );

  -- Un solo instante para todas las comparaciones e inserciones, capturado
  -- despues del bloqueo para no arrastrar la espera en cola.
  v_now := clock_timestamp();

  SELECT
    count(*) FILTER (WHERE e.accepted_at > v_now - INTERVAL '60 seconds'),
    count(*) FILTER (WHERE e.accepted_at > v_now - INTERVAL '3600 seconds'),
    count(*) FILTER (WHERE e.accepted_at > v_now - INTERVAL '86400 seconds'),
    min(e.accepted_at) FILTER (WHERE e.accepted_at > v_now - INTERVAL '60 seconds'),
    min(e.accepted_at) FILTER (WHERE e.accepted_at > v_now - INTERVAL '3600 seconds'),
    min(e.accepted_at) FILTER (WHERE e.accepted_at > v_now - INTERVAL '86400 seconds')
  INTO v_minute, v_hour, v_day, v_oldest_minute, v_oldest_hour, v_oldest_day
  FROM public.ip_rate_limit_events e
  WHERE e.ip_address = p_ip_address
    AND e.accepted_at > v_now - INTERVAL '86400 seconds';

  IF v_minute >= 10 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_oldest_minute + INTERVAL '60 seconds' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'minute',
      'limit', 10,
      'current', v_minute,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  IF v_hour >= 100 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_oldest_hour + INTERVAL '3600 seconds' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'hour',
      'limit', 100,
      'current', v_hour,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  IF v_day >= 500 THEN
    v_retry_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_oldest_day + INTERVAL '86400 seconds' - v_now)))::INTEGER
    );
    RETURN json_build_object(
      'status', 'rate_limited',
      'window', 'day',
      'limit', 500,
      'current', v_day,
      'retry_after_seconds', v_retry_seconds
    );
  END IF;

  INSERT INTO public.ip_rate_limit_events (ip_address, accepted_at)
  VALUES (p_ip_address, v_now);

  -- Limpieza acotada a la IP en el hot path. La limpieza global de eventos
  -- antiguos queda pendiente del job de limpieza.
  DELETE FROM public.ip_rate_limit_events
  WHERE ip_address = p_ip_address
    AND accepted_at <= v_now - INTERVAL '24 hours';

  RETURN json_build_object(
    'status', 'allowed',
    'counts', json_build_object(
      'minute', v_minute + 1,
      'hour', v_hour + 1,
      'day', v_day + 1
    ),
    'limits', json_build_object(
      'minute', 10,
      'hour', 100,
      'day', 500
    )
  );
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.check_rate_limit(INET) IS
  'Rate limit por IP con ventanas moviles exactas (t - W, t] de 60 s, 3600 s y 86400 s, '
  'limites 10/100/500. Registra una fila por solicitud aceptada y serializa por IP con pg_advisory_xact_lock. '
  'Requiere el job de limpieza para eliminar eventos de mas de 24 horas.';

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(INET) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ip_rate_limit_events FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_rate_limit(INET) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ip_rate_limit_events FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_rate_limit(INET) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT ALL ON TABLE public.ip_rate_limit_events TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.check_rate_limit(INET) TO service_role';
  END IF;
END $$;