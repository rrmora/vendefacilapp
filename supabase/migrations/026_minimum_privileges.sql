-- T-004-8.5 (C): privilegios minimos y coherentes con la arquitectura actual.
--
-- Contexto (auditoria de privilegios de T-004-8.5):
--   - Las tablas de cuota y presupuesto creadas en 001-004 nunca recibieron
--     grants explicitos para service_role: dependian de los privilegios por
--     defecto de Supabase. En un PostgreSQL 17 sin esos defaults (el harness de
--     integracion del repositorio), run_maintenance() y las RPC de cuota y
--     presupuesto fallan con SQLSTATE 42501 (permission denied for table).
--   - Esos mismos defaults conceden ALL a anon y authenticated. RLS sin
--     politicas contiene la lectura y escritura de filas, pero TRUNCATE no esta
--     sujeto a RLS, por lo que el privilegio es innecesario y peligroso.
--   - reserve_quota, get_quota_status y las RPC de presupuesto solo revocaban
--     EXECUTE a PUBLIC, no a anon ni authenticated: en entornos con defaults
--     seguian siendo invocables por roles cliente.
--   - service_role nunca recibio EXECUTE explicito sobre las RPC de cuota ni de
--     presupuesto, ni USAGE sobre varias secuencias asociadas.
--
-- Alcance:
--   - Concede a service_role solo los privilegios de tabla y secuencia que los
--     flujos verificados del backend necesitan.
--   - Revoca de anon, authenticated y PUBLIC los privilegios directos
--     innecesarios sobre quota_reservations, visitor_daily_quota,
--     generation_records, budget_tracking y sus secuencias.
--   - Restringe EXECUTE de las RPC de cuota, presupuesto, rate limit y
--     mantenimiento a service_role (contrato: solo el backend las invoca).
--   - Conserva RLS y sus politicas; no usa RLS como sustituto de la revocacion
--     de TRUNCATE u otros privilegios de tabla.
--   - Mantiene SECURITY INVOKER en run_maintenance. No crea roles propietarios
--     ni funciones SECURITY DEFINER. No modifica 001-025.
--
-- Privilegios por flujo (service_role, SECURITY INVOKER):
--   reserve_quota:              visitor_daily_quota SELECT+INSERT+UPDATE,
--                               quota_reservations SELECT+INSERT, secuencias.
--   mark_quota_sent/confirm_quota: quota_reservations SELECT+UPDATE.
--   release_quota:              quota_reservations SELECT+UPDATE y
--                               visitor_daily_quota SELECT+UPDATE.
--   get_quota_status:           visitor_daily_quota SELECT, quota_reservations SELECT.
--   expire_pending_reservations: quota_reservations SELECT+UPDATE,
--                               generation_records SELECT, visitor_daily_quota SELECT+UPDATE.
--   reserve_budget/get_budget_status: budget_tracking SELECT+INSERT+UPDATE.
--   confirm_budget/release_budget/reconcile_pending_budget_reservations:
--                               budget_tracking SELECT+UPDATE (budget_reservations ya
--                               tiene SELECT+INSERT+UPDATE desde 014).
--   recordGeneration (app):     generation_records INSERT + secuencia.
--   check_rate_limit/cleanup:   ip_rate_limit_events ya tiene ALL desde 018.
--   run_maintenance:            maintenance_runs ya tiene SELECT+INSERT+UPDATE y
--                               secuencia desde 023.

-- 1) Privilegios minimos de tabla y secuencia para service_role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.visitor_daily_quota TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.quota_reservations TO service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.generation_records TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.budget_tracking TO service_role';
    EXECUTE 'GRANT USAGE ON SEQUENCE public.visitor_daily_quota_id_seq TO service_role';
    EXECUTE 'GRANT USAGE ON SEQUENCE public.quota_reservations_id_seq TO service_role';
    EXECUTE 'GRANT USAGE ON SEQUENCE public.generation_records_id_seq TO service_role';
    EXECUTE 'GRANT USAGE ON SEQUENCE public.budget_tracking_id_seq TO service_role';
    -- 014 concedio ALL sobre la tabla budget_reservations, pero no sobre su
    -- secuencia; sin USAGE, reserve_budget no puede insertar.
    EXECUTE 'GRANT USAGE ON SEQUENCE public.budget_reservations_id_seq TO service_role';
    -- 018 concedio ALL sobre la tabla ip_rate_limit_events, pero no sobre su
    -- secuencia; sin USAGE, check_rate_limit no puede insertar.
    EXECUTE 'GRANT USAGE ON SEQUENCE public.ip_rate_limit_events_id_seq TO service_role';
  END IF;
END $$;

-- 2) EXECUTE: solo service_role invoca las RPC del backend.
DO $$
DECLARE
  v_signature TEXT;
  v_signatures TEXT[] := ARRAY[
    'public.reserve_quota(UUID, DATE, UUID)',
    'public.confirm_quota(UUID)',
    'public.release_quota(UUID)',
    'public.get_quota_status(UUID, DATE)',
    'public.mark_quota_sent(UUID)',
    'public.expire_pending_reservations()',
    'public.reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC)',
    'public.confirm_budget(UUID, NUMERIC, BOOLEAN)',
    'public.release_budget(UUID)',
    'public.get_budget_status(VARCHAR, NUMERIC)',
    'public.check_rate_limit(INET)',
    'public.reconcile_pending_budget_reservations(INTERVAL)',
    'public.cleanup_rate_limit_events(INTERVAL, INTEGER)',
    'public.cleanup_rate_limit_events_core(INTERVAL, INTEGER)',
    'public.cleanup_rate_limit_events_status(INTERVAL, INTEGER)',
    'public.run_maintenance()'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_signature);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_signature);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_signature);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END IF;
  END LOOP;
END $$;

-- 3) Revoca de anon y authenticated los privilegios directos innecesarios
--    sobre las cuatro tablas de cuota y presupuesto y sus secuencias.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.visitor_daily_quota FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.quota_reservations FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.generation_records FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.budget_tracking FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.visitor_daily_quota_id_seq FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.quota_reservations_id_seq FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.generation_records_id_seq FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.budget_tracking_id_seq FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.visitor_daily_quota FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.quota_reservations FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.generation_records FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.budget_tracking FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.visitor_daily_quota_id_seq FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.quota_reservations_id_seq FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.generation_records_id_seq FROM authenticated';
    EXECUTE 'REVOKE ALL ON SEQUENCE public.budget_tracking_id_seq FROM authenticated';
  END IF;
END $$;

-- 4) PUBLIC no debe conservar privilegios efectivos sobre estas tablas ni
--    secuencias (por defecto PostgreSQL no concede ninguno aqui, pero se
--    revoca de forma dirigida y defensiva; no se revocan permisos globales).
REVOKE ALL ON TABLE public.visitor_daily_quota FROM PUBLIC;
REVOKE ALL ON TABLE public.quota_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.generation_records FROM PUBLIC;
REVOKE ALL ON TABLE public.budget_tracking FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.visitor_daily_quota_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.quota_reservations_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.generation_records_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.budget_tracking_id_seq FROM PUBLIC;

-- 5) Normaliza los privilegios efectivos de service_role al minimo verificado.
--    En entornos con los defaults de Supabase, service_role hereda ALL sobre
--    las tablas y secuencias creadas despues de esos defaults. Los REVOKE de lo
--    no usado mantienen el mismo estado minimo que en un PostgreSQL sin
--    defaults, sin recurrir a GRANT ALL.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.visitor_daily_quota FROM service_role';
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.quota_reservations FROM service_role';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.generation_records FROM service_role';
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.budget_tracking FROM service_role';
    -- 014 concedio ALL sobre budget_reservations; se conserva SELECT+INSERT+UPDATE.
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.budget_reservations FROM service_role';
    -- 018 concedio ALL sobre ip_rate_limit_events; se conserva SELECT+INSERT+UPDATE+DELETE
    -- (cleanup usa FOR UPDATE SKIP LOCKED, que exige UPDATE).
    EXECUTE 'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ip_rate_limit_events FROM service_role';
    -- Las secuencias solo requieren USAGE (nextval); no SELECT ni UPDATE.
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.visitor_daily_quota_id_seq FROM service_role';
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.quota_reservations_id_seq FROM service_role';
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.generation_records_id_seq FROM service_role';
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.budget_tracking_id_seq FROM service_role';
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.budget_reservations_id_seq FROM service_role';
    EXECUTE 'REVOKE SELECT, UPDATE ON SEQUENCE public.ip_rate_limit_events_id_seq FROM service_role';
  END IF;
END $$;

COMMENT ON TABLE public.visitor_daily_quota IS
  'RLS activo: solo service_role. Privilegios minimos definidos en 026.';
COMMENT ON TABLE public.quota_reservations IS
  'RLS activo: solo service_role. Privilegios minimos definidos en 026.';
COMMENT ON TABLE public.generation_records IS
  'RLS activo: solo service_role. Privilegios minimos definidos en 026.';
COMMENT ON TABLE public.budget_tracking IS
  'RLS activo: solo service_role. Privilegios minimos definidos en 026.';
