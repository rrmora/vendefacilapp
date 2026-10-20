-- T-004-8.2: corrige la conciliacion de reservas de presupuesto cuando varias
-- reservas vencidas pertenecen al mismo periodo presupuestario.
--
-- Causa raiz: la version vigente (016) consolidaba con
--   UPDATE budget_tracking t ... FROM stale s
-- En PostgreSQL, cuando varias filas de la fuente coinciden con la misma fila
-- destino, solo se aplica una actualizacion: con dos reservas vencidas del mismo
-- mes solo se consolidaba una de ellas, el gasto quedaba subcontado y
-- reserved_usd conservaba el monto de la reserva que si se habia confirmado.
--
-- Correccion: se agregan las reservas vencidas por budget_month y se suma el
-- total una sola vez por periodo. Firma, parametro y retorno INTEGER se conservan.
--
-- Se mantienen sin cambios:
--   - la politica conservadora: las reservas antiguas o ambiguas se confirman
--     con el costo reservado y cost_estimated = TRUE;
--   - la idempotencia: solo se confirman reservas que siguen en 'reserved', por
--     lo que una segunda ejecucion no vuelve a contabilizar;
--   - la consistencia con confirm_budget y release_budget: la transicion de
--     estado y el ajuste de budget_tracking ocurren en una sola sentencia, con
--     los mismos bloqueos de fila que usa el resto de las RPC de presupuesto.
--   - completed_at usa clock_timestamp() (no NOW()) porque NOW() es el inicio de
--     la transaccion: una transaccion larga que actualiza filas creadas por
--     otras transacciones escribiria un completed_at anterior a created_at y
--     violaria el CHECK chk_completed_after_created. Es el mismo criterio que
--     usa check_rate_limit desde la migracion 018.
--
-- Se anade SET search_path = public, pg_temp a la funcion.

CREATE OR REPLACE FUNCTION public.reconcile_pending_budget_reservations(
  p_max_age INTERVAL DEFAULT INTERVAL '15 minutes'
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Las sentencias modificadoras de datos dentro de WITH se ejecutan exactamente
  -- una vez y siempre a completas, aunque la consulta principal no lea su salida.
  WITH stale AS (
    UPDATE public.budget_reservations b
    SET status = 'confirmed',
        actual_cost_usd = b.reserved_cost_usd,
        cost_estimated = TRUE,
        completed_at = clock_timestamp(),
        updated_at = NOW()
    WHERE b.status = 'reserved'
      AND b.created_at < NOW() - p_max_age
    RETURNING b.budget_month, b.reserved_cost_usd
  ),
  committed AS (
    -- Agrupar por periodo: sin este GROUP BY el ajuste se aplicaria una sola vez
    -- por fila de budget_tracking.
    SELECT budget_month, COALESCE(SUM(reserved_cost_usd), 0) AS committed_usd
    FROM stale
    GROUP BY budget_month
  ),
  quota_applied AS (
    UPDATE public.budget_tracking t
    SET spent_usd = t.spent_usd + c.committed_usd,
        reserved_usd = GREATEST(t.reserved_usd - c.committed_usd, 0),
        updated_at = NOW()
    FROM committed c
    WHERE t.month = c.budget_month
  )
  SELECT COUNT(*) INTO v_count FROM stale;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql
SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) IS
  'Confirma de forma conservadora las reservas de presupuesto mas antiguas que p_max_age: '
  'las marca confirmed con actual_cost_usd = reserved_cost_usd y cost_estimated = TRUE, y ajusta '
  'budget_tracking agrupando por budget_month. Idempotente: solo procesa reservas en status reserved.';

REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) TO service_role';
  END IF;
END $$;
