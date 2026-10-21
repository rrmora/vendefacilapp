import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

function readAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map(readMigration).join('\n');
}

describe('schema migrations', () => {
  describe('archivos de migracion', () => {
    it('contiene 23 archivos SQL', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
      expect(files).toHaveLength(23);
    });

    it('nombres de migracion ordenados correctamente', () => {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(files[0]).toMatch(/^001_/);
      expect(files[10]).toMatch(/^011_/);
      expect(files[11]).toMatch(/^012_/);
      expect(files[12]).toMatch(/^013_/);
      expect(files[13]).toMatch(/^014_/);
      expect(files[14]).toMatch(/^015_/);
      expect(files[15]).toMatch(/^016_/);
      expect(files[16]).toMatch(/^017_/);
      expect(files[17]).toMatch(/^018_/);
      expect(files[18]).toMatch(/^019_/);
      expect(files[19]).toMatch(/^020_/);
      expect(files[20]).toMatch(/^021_/);
      expect(files[21]).toMatch(/^022_/);
      expect(files[22]).toMatch(/^023_/);
    });
  });

  describe('tabla visitor_daily_quota', () => {
    const sql = readMigration('001_create_visitor_daily_quota.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS visitor_daily_quota');
    });

    it('tiene clave primaria', () => {
      expect(sql).toContain('id BIGSERIAL PRIMARY KEY');
    });

    it('tiene visitor_id UUID', () => {
      expect(sql).toContain('visitor_id UUID NOT NULL');
    });

    it('tiene quota_date DATE', () => {
      expect(sql).toContain('quota_date DATE NOT NULL');
    });

    it('tiene generations_used con default 0', () => {
      expect(sql).toContain('generations_used INTEGER NOT NULL DEFAULT 0');
    });

    it('tiene max_generations con default 5', () => {
      expect(sql).toContain('max_generations INTEGER NOT NULL DEFAULT 5');
    });

    it('tiene restriccion generations_used >= 0', () => {
      expect(sql).toContain('CHECK (generations_used >= 0)');
    });

    it('tiene restriccion max_generations > 0', () => {
      expect(sql).toContain('CHECK (max_generations > 0)');
    });

    it('tiene unicidad visitor_id + quota_date', () => {
      expect(sql).toContain('UNIQUE (visitor_id, quota_date)');
    });

    it('usa timestamptz', () => {
      expect(sql).toContain('TIMESTAMPTZ');
    });

    it('tiene indice de lookup', () => {
      expect(sql).toContain('idx_quota_lookup');
    });
  });

  describe('tabla quota_reservations', () => {
    const sql = readMigration('002_create_quota_reservations.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS quota_reservations');
    });

    it('tiene estados validos', () => {
      expect(sql).toContain("'pending'");
      expect(sql).toContain("'completed'");
      expect(sql).toContain("'released'");
      expect(sql).toContain("'expired'");
    });

    it('tiene reservation_id unico', () => {
      expect(sql).toContain('UNIQUE (reservation_id)');
    });

    it('tiene expires_at', () => {
      expect(sql).toContain('expires_at TIMESTAMPTZ NOT NULL');
    });

    it('tiene restriccion expires_at > created_at', () => {
      expect(sql).toContain('CHECK (expires_at > created_at)');
    });

    it('tiene indice de pendientes', () => {
      expect(sql).toContain('idx_reservations_pending');
    });

    it('tiene indice de expiracion', () => {
      expect(sql).toContain('idx_reservations_expiry');
    });
  });

  describe('migracion 017 proteccion persistente de reservas', () => {
    const sql = readMigration('017_quota_reservation_protection.sql');

    it('reemplaza el CHECK de estados incluyendo sent_uncertain', () => {
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS quota_reservations_status_check');
      expect(sql).toContain("CHECK (status IN ('pending', 'sent_uncertain', 'completed', 'released', 'expired'))");
    });

    it('define mark_quota_sent con bloqueo de fila', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.mark_quota_sent(p_reservation_id UUID)');
      expect(sql).toContain("SET status = 'sent_uncertain'");
      expect(sql).toContain('FOR UPDATE');
    });

    it('confirm_quota y release_quota aceptan reservas inciertas', () => {
      expect(sql).toContain("IF v_status NOT IN ('pending', 'sent_uncertain') THEN");
    });

    it('expire_pending_reservations completa-incertas pero solo expira pendientes', () => {
      expect(sql).toContain("WHERE r.status IN ('pending', 'sent_uncertain')");
      expect(sql).toContain("WHERE status = 'pending' AND expires_at < NOW()");
    });

    it('revoca EXECUTE a PUBLIC, anon y authenticated y concede a service_role', () => {
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM PUBLIC');
      expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM anon");
      expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.mark_quota_sent(UUID) FROM authenticated");
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mark_quota_sent(UUID) TO service_role');
    });
  });

  describe('migracion 018 rate limit con ventana movil', () => {
    const sql = readMigration('018_sliding_window_rate_limit.sql');

    it('crea la tabla de eventos aceptados', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.ip_rate_limit_events');
      expect(sql).toContain('ip_address INET NOT NULL');
      expect(sql).toContain('accepted_at TIMESTAMPTZ NOT NULL');
    });

    it('crea el indice compuesto por IP y ventana', () => {
      expect(sql).toContain('ON public.ip_rate_limit_events (ip_address, accepted_at DESC)');
    });

    it('activa RLS sin tocar la tabla legada', () => {
      expect(sql).toContain('ALTER TABLE public.ip_rate_limit_events ENABLE ROW LEVEL SECURITY');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('ALTER TABLE public.ip_rate_limits');
      expect(sql).not.toContain('DELETE FROM public.ip_rate_limits');
    });

    it('serializa por IP con bloqueo consultivo transaccional', () => {
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(sql).toContain('hashtextextended');
    });

    it('captura el reloj una sola vez despues del bloqueo', () => {
      expect(sql.match(/v_now := clock_timestamp\(\);/g)).toHaveLength(1);
      expect(sql.indexOf('PERFORM pg_catalog.pg_advisory_xact_lock')).toBeLessThan(
        sql.indexOf('v_now := clock_timestamp();')
      );
    });

    it('usa ventanas moviles de 60, 3600 y 86400 segundos', () => {
      expect(sql).toContain("INTERVAL '60 seconds'");
      expect(sql).toContain("INTERVAL '3600 seconds'");
      expect(sql).toContain("INTERVAL '86400 seconds'");
      expect(sql).toContain('> v_now - INTERVAL');
    });

    it('mantiene los limites 10, 100 y 500 y el contrato JSON', () => {
      expect(sql).toContain('v_minute >= 10');
      expect(sql).toContain('v_hour >= 100');
      expect(sql).toContain('v_day >= 500');
      expect(sql).toContain("'status', 'allowed'");
      expect(sql).toContain("'counts', json_build_object(");
      expect(sql).toContain("'limits', json_build_object(");
      expect(sql).toContain("'retry_after_seconds', v_retry_seconds");
    });

    it('fija un search_path seguro y restringe EXECUTE', () => {
      expect(sql).toContain('SET search_path = public, pg_temp');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.check_rate_limit(INET) FROM PUBLIC');
      expect(sql).toContain("REVOKE ALL ON TABLE public.ip_rate_limit_events FROM anon");
      expect(sql).toContain("REVOKE ALL ON TABLE public.ip_rate_limit_events FROM authenticated");
      expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.check_rate_limit(INET) TO service_role");
    });

    it('documenta que la limpieza global requiere el job pendiente', () => {
      expect(sql).toContain('job de limpieza');
      expect(sql).toContain('DELETE FROM public.ip_rate_limit_events');
    });
  });

  describe('migracion 019 correccion de expiracion de cuota', () => {
    const sql = readMigration('019_fix_quota_expiration.sql');

    it('conserva la firma sin parametros y el retorno INTEGER', () => {
      expect(sql).toContain(
        'CREATE OR REPLACE FUNCTION public.expire_pending_reservations() RETURNS INTEGER'
      );
      expect(sql).toContain('RETURN v_expired_count;');
    });

    it('agrupa las reservas expiradas por visitor_id y quota_date', () => {
      expect(sql).toContain('COUNT(*)::INTEGER AS units');
      expect(sql).toContain('GROUP BY visitor_id, quota_date');
      expect(sql).toContain('SET generations_used = GREATEST(q.generations_used - r.units, 0)');
      expect(sql).toContain("(created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date");
    });

    it('nunca libera sent_uncertain y conserva la finalizacion conservadora', () => {
      expect(sql).toContain("WHERE r.status IN ('pending', 'sent_uncertain')");
      expect(sql).toContain('g.success = TRUE');
      expect(sql).toContain("WHERE status = 'pending' AND expires_at < NOW()");
    });

    it('fija un search_path seguro y restringe EXECUTE', () => {
      expect(sql).toContain('SET search_path = public, pg_temp');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC');
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM anon"
      );
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM authenticated"
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role'
      );
    });
  });

  describe('migracion 020 correccion de reconciliacion de presupuesto', () => {
    const sql = readMigration('020_fix_budget_reconciliation.sql');

    it('conserva la firma, el parametro y el retorno INTEGER', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.reconcile_pending_budget_reservations(');
      expect(sql).toContain("p_max_age INTERVAL DEFAULT INTERVAL '15 minutes'");
      expect(sql).toContain(') RETURNS INTEGER AS $$');
      expect(sql).toContain('SELECT COUNT(*) INTO v_count FROM stale;');
    });

    it('agrupa las reservas vencidas por budget_month', () => {
      expect(sql).toContain('GROUP BY budget_month');
      expect(sql).toContain('SUM(reserved_cost_usd)');
      expect(sql).toContain('SET spent_usd = t.spent_usd + c.committed_usd');
      expect(sql).toContain('reserved_usd = GREATEST(t.reserved_usd - c.committed_usd, 0),');
    });

    it('mantiene la politica conservadora y la idempotencia', () => {
      expect(sql).toContain('cost_estimated = TRUE');
      expect(sql).toContain('actual_cost_usd = b.reserved_cost_usd');
      expect(sql).toContain("WHERE b.status = 'reserved'");
    });

    it('fija un search_path seguro y restringe EXECUTE', () => {
      expect(sql).toContain('SET search_path = public, pg_temp');
      expect(sql).toContain(
        'REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM PUBLIC'
      );
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM anon"
      );
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) FROM authenticated"
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.reconcile_pending_budget_reservations(INTERVAL) TO service_role'
      );
    });
  });

  describe('migracion 021 timestamps de transicion de cuota', () => {
    const sql = readMigration('021_fix_quota_transition_timestamps.sql');

    it('conserva firmas, retornos y parametros', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.confirm_quota(p_reservation_id UUID) RETURNS JSON');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.release_quota(p_reservation_id UUID) RETURNS JSON');
      expect(sql).toContain(
        'CREATE OR REPLACE FUNCTION public.expire_pending_reservations() RETURNS INTEGER'
      );
      expect(sql).toContain("RETURN json_build_object('status', 'confirmed');");
      expect(sql).toContain("RETURN json_build_object('status', 'released');");
      expect(sql).toContain('RETURN v_expired_count;');
    });

    it('escribe completed_at con clock_timestamp() y no con NOW()', () => {
      expect(sql).toContain(
        "SET status = 'completed', completed_at = GREATEST(clock_timestamp(), created_at)"
      );
      expect(sql).toContain(
        "SET status = 'released', completed_at = GREATEST(clock_timestamp(), created_at)"
      );
      expect(sql).not.toContain('completed_at = NOW()');
      expect(sql).not.toContain('completed_at = now()');
      expect(sql).not.toContain('completed_at = clock_timestamp()');
    });

    it('captura el reloj una sola vez en la expiracion y lo usa en todas las transiciones', () => {
      expect(sql.match(/v_now := clock_timestamp\(\);/g)).toHaveLength(1);
      expect(sql).toContain("SET status = 'completed', completed_at = GREATEST(v_now, created_at)");
      expect(sql).toContain("SET status = 'expired', completed_at = GREATEST(v_now, created_at)");
      expect(sql).toContain('AND r.expires_at < v_now');
      expect(sql).toContain("WHERE status = 'pending' AND expires_at < v_now");
      expect(sql).toContain('updated_at = v_now');
    });

    it('conserva la proteccion de sent_uncertain y la agrupacion de expiracion', () => {
      expect(sql).toContain("WHERE r.status IN ('pending', 'sent_uncertain')");
      expect(sql).toContain("WHERE status = 'pending' AND expires_at < v_now");
      expect(sql).toContain('g.success = TRUE');
      expect(sql).toContain('COUNT(*)::INTEGER AS units');
      expect(sql).toContain('GROUP BY visitor_id, quota_date');
      expect(sql).toContain('SET generations_used = GREATEST(q.generations_used - r.units, 0)');
      expect(sql).toContain("(created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date");
    });

    it('conserva la idempotencia de confirmacion y liberacion', () => {
      expect(sql.match(/IF v_status NOT IN \('pending', 'sent_uncertain'\) THEN/g)).toHaveLength(2);
      expect(sql.match(/'status', 'already_processed'/g)).toHaveLength(2);
    });

    it('no redefine mark_quota_sent', () => {
      expect(sql).not.toContain('FUNCTION public.mark_quota_sent');
    });

    it('fija un search_path seguro y restringe EXECUTE', () => {
      expect(sql.match(/SET search_path = public, pg_temp/g)).toHaveLength(3);
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.confirm_quota(UUID) FROM PUBLIC');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.release_quota(UUID) FROM PUBLIC');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM PUBLIC');
      expect(sql).toContain(
        "REVOKE EXECUTE ON FUNCTION public.expire_pending_reservations() FROM authenticated"
      );
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.confirm_quota(UUID) TO service_role');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.release_quota(UUID) TO service_role');
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.expire_pending_reservations() TO service_role'
      );
    });
  });

  describe('migracion 022 limpieza global de rate limit', () => {
    const sql = readMigration('022_cleanup_rate_limit_events.sql');

    it('define la funcion con retencion y lote por defecto', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cleanup_rate_limit_events(');
      expect(sql).toContain("p_retention INTERVAL DEFAULT INTERVAL '25 hours'");
      expect(sql).toContain('p_batch_size INTEGER DEFAULT 1000');
      expect(sql).toContain(') RETURNS INTEGER AS $$');
      expect(sql).toContain('RETURN v_total;');
    });

    it('impone retencion minima de 25 horas y un lote valido', () => {
      expect(sql).toContain("p_retention < INTERVAL '25 hours'");
      expect(sql).toContain('p_batch_size < 1');
    });

    it('elimina por lotes con SKIP LOCKED y sin dejar eventos elegibles', () => {
      expect(sql).toContain('LIMIT p_batch_size');
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('GET DIAGNOSTICS v_deleted = ROW_COUNT;');
      expect(sql).toContain('EXIT WHEN v_deleted = 0;');
      expect(sql).toContain('v_cutoff := clock_timestamp() - p_retention;');
    });

    it('serializa limpiezas concurrentes', () => {
      expect(sql).toContain('pg_catalog.pg_try_advisory_xact_lock');
      expect(sql).toContain("pg_catalog.hashtextextended('public.cleanup_rate_limit_events', 0)");
    });

    it('crea el indice de barrido global y no redefine check_rate_limit', () => {
      expect(sql).toContain('idx_ip_rate_events_accepted_at_id');
      expect(sql).toContain('ON public.ip_rate_limit_events (accepted_at, id)');
      expect(sql).not.toContain('FUNCTION public.check_rate_limit');
    });

    it('fija search_path y restringe EXECUTE a service_role', () => {
      expect(sql).toContain('SET search_path = public, pg_temp');
      expect(sql).toContain(
        'REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) FROM PUBLIC'
      );
      expect(sql).toContain(
        'GRANT EXECUTE ON FUNCTION public.cleanup_rate_limit_events(INTERVAL, INTEGER) TO service_role'
      );
    });
  });

  describe('migracion 023 tabla de auditoria del mantenimiento', () => {
    const sql = readMigration('023_maintenance_runs.sql');

    it('crea la tabla con identificador, inicio, fin y estado', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.maintenance_runs');
      expect(sql).toContain('id BIGSERIAL PRIMARY KEY');
      expect(sql).toContain('started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()');
      expect(sql).toContain('finished_at TIMESTAMPTZ');
      expect(sql).toContain("status VARCHAR(20) NOT NULL DEFAULT 'running'");
    });

    it('limita los estados de ejecucion', () => {
      expect(sql).toContain("CHECK (status IN ('running', 'success', 'partial', 'failed'))");
    });

    it('define contadores no negativos para las tareas de mantenimiento', () => {
      expect(sql).toContain('expired_quota_reservations INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('reconciled_budget_reservations INTEGER NOT NULL DEFAULT 0');
      expect(sql).toContain('deleted_rate_limit_events INTEGER NOT NULL DEFAULT 0');
      expect(sql.match(/INTEGER NOT NULL DEFAULT 0\s+CHECK \([a-z_]+ >= 0\)/g)).toHaveLength(3);
    });

    it('almacena errores como objeto JSON y los exige en partial o failed', () => {
      expect(sql).toContain("error_details JSONB NOT NULL DEFAULT '{}'::JSONB");
      expect(sql).toContain("CHECK (jsonb_typeof(error_details) = 'object')");
      expect(sql).toContain('chk_maintenance_failure_details');
      expect(sql).toContain("status NOT IN ('partial', 'failed') OR error_details <> '{}'::JSONB");
    });

    it('deriva duration_ms y valida la coherencia temporal', () => {
      expect(sql).toContain('duration_ms BIGINT GENERATED ALWAYS AS (');
      expect(sql).toContain('EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000');
      expect(sql).toContain(') STORED');
      expect(sql).toContain('chk_maintenance_finished_after_started');
      expect(sql).toContain('chk_maintenance_finished_matches_status');
      expect(sql).toContain("(status = 'running') = (finished_at IS NULL)");
    });

    it('crea indices para historial y ejecuciones en curso', () => {
      expect(sql).toContain('idx_maintenance_runs_started_at');
      expect(sql).toContain('ON public.maintenance_runs (started_at DESC)');
      expect(sql).toContain('idx_maintenance_runs_running');
      expect(sql).toContain("WHERE status = 'running'");
    });

    it('activa RLS y restringe el acceso a service_role', () => {
      expect(sql).toContain('ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY');
      expect(sql).toContain('REVOKE ALL ON TABLE public.maintenance_runs FROM PUBLIC');
      expect(sql).toContain("REVOKE ALL ON TABLE public.maintenance_runs FROM anon");
      expect(sql).toContain("REVOKE ALL ON TABLE public.maintenance_runs FROM authenticated");
      expect(sql).toContain(
        'GRANT SELECT, INSERT, UPDATE ON TABLE public.maintenance_runs TO service_role'
      );
      expect(sql).toContain(
        'GRANT USAGE, SELECT ON SEQUENCE public.maintenance_runs_id_seq TO service_role'
      );
      expect(sql).toContain("REVOKE ALL ON SEQUENCE public.maintenance_runs_id_seq FROM anon");
      expect(sql).toContain(
        "REVOKE ALL ON SEQUENCE public.maintenance_runs_id_seq FROM authenticated"
      );
      expect(sql).not.toContain('GRANT DELETE');
      expect(sql).not.toContain('GRANT UPDATE ON SEQUENCE');
    });

    it('no implementa run_maintenance ni modifica migraciones historicas', () => {
      expect(sql).not.toContain('FUNCTION public.run_maintenance');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('ALTER TABLE public.quota_reservations');
      expect(sql).not.toContain('ALTER TABLE public.ip_rate_limit_events');
    });
  });

  describe('tabla generation_records', () => {
    const sql = readMigration('003_create_generation_records.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS generation_records');
    });

    it('tiene success BOOLEAN', () => {
      expect(sql).toContain('success BOOLEAN NOT NULL');
    });

    it('tiene tokens_input y tokens_output', () => {
      expect(sql).toContain('tokens_input INTEGER');
      expect(sql).toContain('tokens_output INTEGER');
    });

    it('tiene estimated_cost_usd', () => {
      expect(sql).toContain('estimated_cost_usd NUMERIC(10, 6)');
    });

    it('tiene cost_estimated flag', () => {
      expect(sql).toContain('cost_estimated BOOLEAN');
    });

    it('tiene foranea a quota_reservations', () => {
      expect(sql).toContain('FOREIGN KEY (reservation_id)');
      expect(sql).toContain('REFERENCES quota_reservations (reservation_id)');
    });

    it('tiene ON DELETE SET NULL', () => {
      expect(sql).toContain('ON DELETE SET NULL');
    });

    it('tiene indice de costo', () => {
      expect(sql).toContain('idx_gen_cost');
    });
  });

  describe('tabla budget_tracking', () => {
    const sql = readMigration('004_create_budget_tracking.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS budget_tracking');
    });

    it('tiene month VARCHAR(7)', () => {
      expect(sql).toContain('month VARCHAR(7) NOT NULL');
    });

    it('tiene total_budget_usd default 5.00', () => {
      expect(sql).toContain('total_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5.00');
    });

    it('tiene spent_usd', () => {
      expect(sql).toContain('spent_usd NUMERIC(10, 6)');
    });

    it('tiene reserved_usd', () => {
      expect(sql).toContain('reserved_usd NUMERIC(10, 6)');
    });

    it('tiene restriccion de formato month', () => {
      expect(sql).toContain("CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')");
    });

    it('tiene unicidad por mes', () => {
      expect(sql).toContain('UNIQUE (month)');
    });
  });

  describe('tabla ip_rate_limits', () => {
    const sql = readMigration('005_create_ip_rate_limits.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS ip_rate_limits');
    });

    it('tiene ip_address INET', () => {
      expect(sql).toContain('ip_address INET NOT NULL');
    });

    it('tiene window_start TIMESTAMPTZ', () => {
      expect(sql).toContain('window_start TIMESTAMPTZ NOT NULL');
    });

    it('tiene request_count', () => {
      expect(sql).toContain('request_count INTEGER');
    });

    it('tiene unicidad ip + window', () => {
      expect(sql).toContain('UNIQUE (ip_address, window_start)');
    });
  });

  describe('RLS', () => {
    const sql = readMigration('006_enable_rls.sql');

    it('activa RLS en visitor_daily_quota', () => {
      expect(sql).toContain('ALTER TABLE visitor_daily_quota ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en quota_reservations', () => {
      expect(sql).toContain('ALTER TABLE quota_reservations ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en generation_records', () => {
      expect(sql).toContain('ALTER TABLE generation_records ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en budget_tracking', () => {
      expect(sql).toContain('ALTER TABLE budget_tracking ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en ip_rate_limits', () => {
      expect(sql).toContain('ALTER TABLE ip_rate_limits ENABLE ROW LEVEL SECURITY');
    });
  });

  describe('consistencia del esquema', () => {
    const allSql = readAllMigrations();

    it('todas las tablas usan timestamptz', () => {
      const tables = [
        'visitor_daily_quota',
        'quota_reservations',
        'generation_records',
        'budget_tracking',
        'ip_rate_limits',
        'maintenance_runs',
      ];

      for (const table of tables) {
        const tableSection =
          allSql
            .split(new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${table}\\b`))[1]
            ?.split(');')[0] || '';
        expect(tableSection).toContain('TIMESTAMPTZ');
      }
    });

    it('no usa TIMESTAMP sin zona horaria', () => {
      const lines = allSql.split('\n');
      const timestampLines = lines.filter((line) =>
        /\bTIMESTAMP\b/i.test(line) && !/\bTIMESTAMPTZ\b/i.test(line)
      );
      expect(timestampLines).toHaveLength(0);
    });

    it('generation_records referencia quota_reservations', () => {
      expect(allSql).toContain('REFERENCES quota_reservations (reservation_id)');
    });

    it('budget_tracking separa spent de reserved', () => {
      expect(allSql).toContain('spent_usd');
      expect(allSql).toContain('reserved_usd');
    });
  });
  describe('seguridad de budget_reservations (014)', () => {
    const sql = readMigration('014_secure_budget_reservations.sql');
    it('habilita RLS', () => {
      expect(sql).toContain('ALTER TABLE IF EXISTS public.budget_reservations ENABLE ROW LEVEL SECURITY');
    });
    it('revoca permisos anon y authenticated', () => {
      expect(sql).toContain('REVOKE ALL ON TABLE public.budget_reservations FROM anon');
      expect(sql).toContain('REVOKE ALL ON TABLE public.budget_reservations FROM authenticated');
    });
    it('revoca EXECUTE de funciones presupuesto', () => {
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.reserve_budget(UUID, VARCHAR, NUMERIC, NUMERIC) FROM anon');
      expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.get_budget_status(VARCHAR, NUMERIC) FROM authenticated');
    });
  });

});
