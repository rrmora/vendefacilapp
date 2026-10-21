-- T-004-8.4: auditoria de ejecuciones del mantenimiento.
--
-- Registro de auditoria para cada ejecucion futura de run_maintenance.
-- No crea la funcion run_maintenance ni schedulers: solo el esquema de auditoria.
-- Los contadores corresponden a las tareas de mantenimiento ya implementadas:
-- expire_pending_reservations, reconcile_pending_budget_reservations y
-- cleanup_rate_limit_events.

CREATE TABLE IF NOT EXISTS public.maintenance_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  expired_quota_reservations INTEGER NOT NULL DEFAULT 0
    CHECK (expired_quota_reservations >= 0),
  reconciled_budget_reservations INTEGER NOT NULL DEFAULT 0
    CHECK (reconciled_budget_reservations >= 0),
  deleted_rate_limit_events INTEGER NOT NULL DEFAULT 0
    CHECK (deleted_rate_limit_events >= 0),
  error_details JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(error_details) = 'object'),
  duration_ms BIGINT GENERATED ALWAYS AS (
    CASE
      WHEN finished_at IS NULL THEN NULL
      ELSE ROUND(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::BIGINT
    END
  ) STORED,
  CONSTRAINT chk_maintenance_finished_after_started
    CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT chk_maintenance_finished_matches_status
    CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT chk_maintenance_failure_details
    CHECK (status NOT IN ('partial', 'failed') OR error_details <> '{}'::JSONB)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_runs_started_at
  ON public.maintenance_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_runs_running
  ON public.maintenance_runs (started_at)
  WHERE status = 'running';

ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.maintenance_runs IS
  'Auditoria de ejecuciones de mantenimiento. RLS activo sin politicas: solo service_role.';
COMMENT ON COLUMN public.maintenance_runs.status IS
  'running: en curso; success: sin errores; partial: fallos parciales; failed: fallo total.';
COMMENT ON COLUMN public.maintenance_runs.expired_quota_reservations IS
  'Reservas de cuota expiradas por expire_pending_reservations.';
COMMENT ON COLUMN public.maintenance_runs.reconciled_budget_reservations IS
  'Reservas de presupuesto reconciliadas por reconcile_pending_budget_reservations.';
COMMENT ON COLUMN public.maintenance_runs.deleted_rate_limit_events IS
  'Eventos eliminados por cleanup_rate_limit_events.';
COMMENT ON COLUMN public.maintenance_runs.error_details IS
  'Objeto JSON con errores por tarea; obligatorio cuando status es partial o failed.';
COMMENT ON COLUMN public.maintenance_runs.duration_ms IS
  'Duracion derivada de finished_at - started_at en milisegundos; null mientras status es running.';

REVOKE ALL ON TABLE public.maintenance_runs FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.maintenance_runs_id_seq FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.maintenance_runs FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.maintenance_runs_id_seq FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.maintenance_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.maintenance_runs_id_seq FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.maintenance_runs TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.maintenance_runs_id_seq TO service_role';
  END IF;
END $$;
