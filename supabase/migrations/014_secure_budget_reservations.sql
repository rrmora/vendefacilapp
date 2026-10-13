-- RLS para budget_reservations: por defecto sin politicas = sin acceso.
ALTER TABLE IF EXISTS public.budget_reservations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.budget_reservations IS 'RLS activo: solo servicio servidor para operar presupuesto.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.budget_reservations FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.budget_reservations FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT ALL ON TABLE public.budget_reservations TO service_role';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_budget(UUID, NUMERIC, BOOLEAN) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.release_budget(UUID) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_budget_status(VARCHAR, NUMERIC) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_budget(UUID, NUMERIC, BOOLEAN) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.release_budget(UUID) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_budget_status(VARCHAR, NUMERIC) FROM authenticated';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_budget(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_budget(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_budget_status(VARCHAR, NUMERIC) FROM PUBLIC;