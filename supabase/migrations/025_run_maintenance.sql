-- T-004-8.5 (B): orquestador de mantenimiento y auditoria.
--
-- run_maintenance coordina las tres tareas de mantenimiento ya implementadas y
-- registra el resultado en public.maintenance_runs:
--   1. expire_pending_reservations()
--   2. reconcile_pending_budget_reservations()
--   3. cleanup_rate_limit_events_status()
--
-- Diseno transaccional (sin commits parciales ni PROCEDURE):
--   - Una FUNCTION PL/pgSQL con SECURITY INVOKER.
--   - Un advisory lock global evita ejecuciones solapadas.
--   - Un bloque EXCEPTION independiente por tarea. Si una tarea falla, su
--     subtransaccion se revierte y el resto del trabajo continua.
--   - La fila running se inserta antes de las tareas y se actualiza al final.
--     Si la transaccion completa se revierte (error fatal, cancelacion o caida de
--     conexion), la auditoria de esa ejecucion tambien se revierte.
--   - WHEN OTHERS no captura QUERY_CANCELED ni ASSERT_FAILURE: un timeout o una
--     cancelacion abortan la transaccion completa y no dejan auditoria.
--
-- La limpieza se invoca con cleanup_rate_limit_events_status(): si retorna
-- already_running, la tarea cuenta como fallida/omitida y no incrementa el
-- contador deleted_rate_limit_events.
--
-- SECURITY INVOKER: el rol ejecutor necesita los mismos privilegios que las RPC
-- de tareas (EXECUTE y acceso a las tablas que cada una toca) y los privilegios
-- de maintenance_runs. No se elevan privilegios aqui.

CREATE OR REPLACE FUNCTION public.run_maintenance()
RETURNS JSONB AS $$
DECLARE
  v_run_id BIGINT;
  v_started TIMESTAMPTZ;
  v_expired INTEGER := 0;
  v_reconciled INTEGER := 0;
  v_deleted INTEGER := 0;
  v_failed_tasks INTEGER := 0;
  v_errors JSONB := '{}'::JSONB;
  v_status TEXT;
  v_sqlstate TEXT;
  v_message TEXT;
  v_cleanup_result JSONB;
  v_cleanup_status TEXT;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('public.run_maintenance', 0)
  ) THEN
    RETURN jsonb_build_object('run_id', NULL, 'status', 'already_running');
  END IF;

  v_started := clock_timestamp();

  INSERT INTO public.maintenance_runs (started_at)
  VALUES (v_started)
  RETURNING id INTO v_run_id;

  -- Tarea 1: expiracion de reservas de cuota vencidas.
  BEGIN
    v_expired := COALESCE(public.expire_pending_reservations(), 0);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_message = MESSAGE_TEXT;
    v_failed_tasks := v_failed_tasks + 1;
    v_errors := v_errors || jsonb_build_object(
      'expire_pending_reservations',
      jsonb_build_object('sqlstate', v_sqlstate, 'message', v_message)
    );
  END;

  -- Tarea 2: reconciliacion conservadora de reservas de presupuesto.
  BEGIN
    v_reconciled := COALESCE(public.reconcile_pending_budget_reservations(), 0);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_message = MESSAGE_TEXT;
    v_failed_tasks := v_failed_tasks + 1;
    v_errors := v_errors || jsonb_build_object(
      'reconcile_pending_budget_reservations',
      jsonb_build_object('sqlstate', v_sqlstate, 'message', v_message)
    );
  END;

  -- Tarea 3: limpieza global de eventos de rate limit.
  BEGIN
    v_cleanup_result := public.cleanup_rate_limit_events_status();
    v_cleanup_status := COALESCE(v_cleanup_result ->> 'status', 'unknown');

    IF v_cleanup_status = 'completed' THEN
      v_deleted := COALESCE((v_cleanup_result ->> 'deleted')::INTEGER, 0);
    ELSE
      v_failed_tasks := v_failed_tasks + 1;
      v_errors := v_errors || jsonb_build_object(
        'cleanup_rate_limit_events',
        jsonb_build_object(
          'status', v_cleanup_status,
          'message', 'cleanup_rate_limit_events omitida por concurrencia'
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_message = MESSAGE_TEXT;
    v_failed_tasks := v_failed_tasks + 1;
    v_errors := v_errors || jsonb_build_object(
      'cleanup_rate_limit_events',
      jsonb_build_object('sqlstate', v_sqlstate, 'message', v_message)
    );
  END;

  v_status := CASE
    WHEN v_failed_tasks = 0 THEN 'success'
    WHEN v_failed_tasks >= 3 THEN 'failed'
    ELSE 'partial'
  END;

  UPDATE public.maintenance_runs
  SET
    status = v_status,
    finished_at = GREATEST(clock_timestamp(), v_started),
    expired_quota_reservations = v_expired,
    reconciled_budget_reservations = v_reconciled,
    deleted_rate_limit_events = v_deleted,
    error_details = v_errors
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'status', v_status,
    'expired_quota_reservations', v_expired,
    'reconciled_budget_reservations', v_reconciled,
    'deleted_rate_limit_events', v_deleted,
    'error_details', v_errors
  );
END;
$$ LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.run_maintenance() IS
  'Ejecuta y audita las tareas de mantenimiento (cuota, presupuesto y rate limit). '
  'Usa un advisory lock global, un bloque de excepcion por tarea y registra '
  'success/partial/failed en maintenance_runs. SECURITY INVOKER: el ejecutor necesita '
  'los privilegios de las tareas y de la tabla de auditoria. Si la transaccion completa '
  'se revierte, la auditoria tambien se revierte.';

REVOKE EXECUTE ON FUNCTION public.run_maintenance() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.run_maintenance() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.run_maintenance() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.run_maintenance() TO service_role';
  END IF;
END $$;
