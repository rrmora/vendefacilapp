import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-run-maintenance-test';
const LIMITED_ROLE = 'vf_run_maintenance_limited';

const VISITOR_ONE = '11111111-1111-4111-8111-111111111111';
const VISITOR_TWO = '11111111-1111-4111-8111-111111111112';

let fixtureCounter = 0;

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 60000 }).trim();
}

function sql(statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${statement.replace(/"/g, '\\"')}"`
  );
}

function sqlAs(role: string, statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SET ROLE ${role}; ${statement};"`
  )
    .split('\n')
    .map((value) => value.trim())
    .filter(
      (value) => value && !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|TRUNCATE TABLE)$/.test(value)
    )
    .join('\n');
}

/**
 * Ejecuta varias sentencias desde un archivo. Evita el limite de linea de
 * comandos y el escape fragil de comillas para las siembras.
 */
function runSql(statements: string, name = 'fixture'): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'vf-runmaint-'));
  const file = `${name}-${fixtureCounter++}.sql`;
  const localPath = join(directory, file);

  writeFileSync(localPath, statements, 'utf8');
  exec(`docker cp "${localPath}" ${CONTAINER_NAME}:/tmp/${file}`);
  const output = exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -q -t -A -f /tmp/${file}`
  );
  rmSync(directory, { recursive: true, force: true });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function jsonLine(lines: string[]): Record<string, unknown> {
  const line = lines.find((value) => value.startsWith('{'));
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

function expectSqlError(statement: string, pattern: RegExp): void {
  let failed = false;
  try {
    sql(statement);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(pattern);
  }
  expect(failed).toBe(true);
}

function probeDatabase(): string | null {
  try {
    return execSync(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT 1;"`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    return null;
  }
}

const seedMantenimiento = `
INSERT INTO public.visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
VALUES ('${VISITOR_ONE}'::uuid, (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date, 3, 5),
       ('${VISITOR_TWO}'::uuid, (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date, 2, 5);

INSERT INTO public.quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
VALUES ('${VISITOR_ONE}'::uuid, '22222222-2222-4222-8222-222222222221'::uuid, 'pending',
        clock_timestamp() - INTERVAL '10 minutes', clock_timestamp() - INTERVAL '5 minutes'),
       ('${VISITOR_TWO}'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, 'pending',
        clock_timestamp() - INTERVAL '10 minutes', clock_timestamp() - INTERVAL '5 minutes');

INSERT INTO public.budget_tracking (month, spent_usd, reserved_usd)
VALUES (to_char(clock_timestamp(), 'YYYY-MM'), 0, 1);

INSERT INTO public.budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, created_at, updated_at)
VALUES ('33333333-3333-4333-8333-333333333331'::uuid, to_char(clock_timestamp(), 'YYYY-MM'), 'reserved', 1,
        clock_timestamp() - INTERVAL '20 minutes', clock_timestamp() - INTERVAL '20 minutes');

INSERT INTO public.ip_rate_limit_events (ip_address, accepted_at)
VALUES ('198.51.100.250'::inet, clock_timestamp() - INTERVAL '26 hours'),
       ('198.51.100.251'::inet, clock_timestamp() - INTERVAL '26 hours'),
       ('198.51.100.252'::inet, clock_timestamp() - INTERVAL '26 hours');
`;

function truncateMantenimiento(): void {
  sql(
    'TRUNCATE public.maintenance_runs, public.quota_reservations, public.generation_records, public.visitor_daily_quota, public.budget_reservations, public.budget_tracking, public.ip_rate_limit_events RESTART IDENTITY CASCADE;'
  );
}

function terminate(applicationName: string): void {
  try {
    sql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '${applicationName}' AND pid <> pg_backend_pid();`
    );
  } catch {
  }
}

async function waitForLock(applicationName: string, description: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const held = sql(
      `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = '${applicationName}';`
    );
    if (held === '1') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout esperando ${description}`);
}

function startLockHolder(applicationName: string, key: string): Promise<{ stdout: string; stderr: string }> {
  const holder = execAsync(
    `docker exec -e PGAPPNAME=${applicationName} ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "BEGIN; SELECT pg_advisory_xact_lock(${key}); SELECT pg_sleep(120); COMMIT;"`
  );
  holder.catch(() => undefined);
  return holder;
}

describe('run_maintenance y cleanup status integration', () => {
  beforeAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }

    exec(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpass123 -e POSTGRES_DB=testdb -d postgres:17-alpine`
    );

    let consecutive = 0;
    for (let i = 0; i < 120 && consecutive < 3; i++) {
      consecutive = probeDatabase() === '1' ? consecutive + 1 : 0;
      if (consecutive < 3) {
        execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore' });
      }
    }

    if (consecutive < 3) {
      throw new Error('PostgreSQL no se pudo iniciar');
    }

    exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"`
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const localPath = join(MIGRATIONS_DIR, file);
      const remotePath = `/tmp/${file}`;
      exec(`docker cp "${localPath}" ${CONTAINER_NAME}:${remotePath}`);
    }

    for (const file of files) {
      const remotePath = `/tmp/${file}`;
      exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f ${remotePath}`);
    }

    sql(`DROP ROLE IF EXISTS ${LIMITED_ROLE};`);
    sql(
      `CREATE ROLE ${LIMITED_ROLE} NOLOGIN BYPASSRLS; GRANT EXECUTE ON FUNCTION public.run_maintenance() TO ${LIMITED_ROLE}; GRANT SELECT, INSERT, UPDATE ON TABLE public.maintenance_runs TO ${LIMITED_ROLE}; GRANT USAGE, SELECT ON SEQUENCE public.maintenance_runs_id_seq TO ${LIMITED_ROLE};`
    );
  }, 300000);

  beforeEach(() => {
    truncateMantenimiento();
  });

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('ejecuta las tres tareas, actualiza contadores y registra success', () => {
    const lines = runSql(`
      ${seedMantenimiento}
      SELECT public.run_maintenance();
    `, 'success');

    const result = jsonLine(lines);
    expect(result.status).toBe('success');
    expect(result.expired_quota_reservations).toBe(2);
    expect(result.reconciled_budget_reservations).toBe(1);
    expect(result.deleted_rate_limit_events).toBe(3);
    expect(result.error_details).toEqual({});
    expect(typeof result.run_id).toBe('number');

    const row = sql(
      'SELECT status, expired_quota_reservations, reconciled_budget_reservations, deleted_rate_limit_events, error_details::text, finished_at >= started_at, duration_ms IS NOT NULL FROM public.maintenance_runs ORDER BY id DESC LIMIT 1;'
    );
    expect(row).toBe('success|2|1|3|{}|t|t');

    const [quota] = sql(
      `SELECT generations_used FROM public.visitor_daily_quota WHERE visitor_id = '${VISITOR_ONE}'::uuid;`
    ).split('|');
    expect(Number(quota)).toBe(2);
  });

  it('es idempotente: la segunda ejecucion no reprocesa trabajo', () => {
    runSql(`
      ${seedMantenimiento}
      SELECT public.run_maintenance();
    `, 'idempotent-seed');

    const lines = runSql('SELECT public.run_maintenance();', 'idempotent-second');
    const result = jsonLine(lines);

    expect(result.status).toBe('success');
    expect(result.expired_quota_reservations).toBe(0);
    expect(result.reconciled_budget_reservations).toBe(0);
    expect(result.deleted_rate_limit_events).toBe(0);
    expect(result.error_details).toEqual({});
  });

  it('acota finished_at al inicio y deriva duration_ms al completar', () => {
    const lines = runSql(`
      ${seedMantenimiento}
      SELECT public.run_maintenance();
      SELECT duration_ms, finished_at >= started_at FROM public.maintenance_runs ORDER BY id DESC LIMIT 1;
    `, 'duration');

    expect(lines[0].startsWith('{')).toBe(true);
    expect(Number(lines[1].split('|')[0])).toBeGreaterThanOrEqual(0);
    expect(lines[1].split('|')[1]).toBe('t');
  });

  it('retorna already_running y no inserta auditoria cuando el lock global esta retenido', async () => {
    const applicationName = 'vf-runmaint-global-lock';

    const holder = startLockHolder(applicationName, "hashtextextended('public.run_maintenance', 0)");

    try {
      await waitForLock(applicationName, 'el lock global de run_maintenance');

      const lines = runSql('SELECT public.run_maintenance();', 'global-lock');
      const result = jsonLine(lines);

      expect(result).toEqual({ run_id: null, status: 'already_running' });
      expect(sql('SELECT count(*) FROM public.maintenance_runs;')).toBe('0');
    } finally {
      terminate(applicationName);
      await holder.catch(() => undefined);
    }
  });

  it('marca partial y no cuenta deleted cuando la limpieza esta omitida por concurrencia', async () => {
    const applicationName = 'vf-runmaint-cleanup-lock';
    const holder = startLockHolder(
      applicationName,
      "hashtextextended('public.cleanup_rate_limit_events', 0)"
    );

    try {
      await waitForLock(applicationName, 'el lock de cleanup_rate_limit_events');

      const lines = runSql(`
        ${seedMantenimiento}
        SELECT public.run_maintenance();
      `, 'cleanup-partial');
      const result = jsonLine(lines);

      expect(result.status).toBe('partial');
      expect(result.expired_quota_reservations).toBe(2);
      expect(result.reconciled_budget_reservations).toBe(1);
      expect(result.deleted_rate_limit_events).toBe(0);
      expect(
        (result.error_details as Record<string, { status: string }>).cleanup_rate_limit_events.status
      ).toBe('already_running');

      const [rowStatus, rowDetails] = sql(
        "SELECT status, error_details->'cleanup_rate_limit_events'->>'status' FROM public.maintenance_runs ORDER BY id DESC LIMIT 1;"
      ).split('|');
      expect(rowStatus).toBe('partial');
      expect(rowDetails).toBe('already_running');
    } finally {
      terminate(applicationName);
      await holder.catch(() => undefined);
    }
  });

  it('marca failed y captura SQLSTATE cuando las tres tareas fallan', () => {
    const output = sqlAs(LIMITED_ROLE, 'SELECT public.run_maintenance()');
    const result = JSON.parse(output.split('\n').filter(Boolean).pop() ?? '{}');

    expect(result.status).toBe('failed');
    expect(result.expired_quota_reservations).toBe(0);
    expect(result.reconciled_budget_reservations).toBe(0);
    expect(result.deleted_rate_limit_events).toBe(0);

    const details = result.error_details as Record<string, { sqlstate: string }>;
    expect(Object.keys(details).sort()).toEqual([
      'cleanup_rate_limit_events',
      'expire_pending_reservations',
      'reconcile_pending_budget_reservations',
    ]);
    for (const key of Object.keys(details)) {
      expect(details[key].sqlstate).toBe('42501');
    }
  });

  it('ejecuta las tres tareas como service_role con los privilegios de la migracion 026', () => {
    runSql(`
      ${seedMantenimiento}
    `, 'service-role-seed');

    const output = sqlAs('service_role', 'SELECT public.run_maintenance()');
    const result = JSON.parse(output.split('\n').filter(Boolean).pop() ?? '{}');

    expect(result.status).toBe('success');
    expect(result.expired_quota_reservations).toBe(2);
    expect(result.reconciled_budget_reservations).toBe(1);
    expect(result.deleted_rate_limit_events).toBe(3);
    expect(result.error_details).toEqual({});
    expect(typeof result.run_id).toBe('number');
    expect(sql("SELECT status FROM public.maintenance_runs ORDER BY id DESC LIMIT 1;")).toBe(
      'success'
    );
  });

  it('cleanup_rate_limit_events_status distingue completed de already_running', async () => {
    const completedLines = runSql(`
      INSERT INTO public.ip_rate_limit_events (ip_address, accepted_at)
      VALUES ('198.51.100.253'::inet, clock_timestamp() - INTERVAL '26 hours'),
             ('198.51.100.254'::inet, clock_timestamp() - INTERVAL '26 hours'),
             ('198.51.100.255'::inet, clock_timestamp() - INTERVAL '23 hours');
      SELECT public.cleanup_rate_limit_events_status();
    `, 'status-completed');

    expect(jsonLine(completedLines)).toEqual({ status: 'completed', deleted: 2 });
    expect(
      sql("SELECT count(*) FROM public.ip_rate_limit_events WHERE ip_address = '198.51.100.255'::inet;")
    ).toBe('1');

    const applicationName = 'vf-runmaint-status-lock';
    const holder = startLockHolder(
      applicationName,
      "hashtextextended('public.cleanup_rate_limit_events', 0)"
    );

    try {
      await waitForLock(applicationName, 'el lock de cleanup para la variante status');

      expect(jsonLine(runSql('SELECT public.cleanup_rate_limit_events_status();', 'status-busy'))).toEqual({
        status: 'already_running',
        deleted: 0,
      });
      expect(sql('SELECT public.cleanup_rate_limit_events();')).toBe('0');
    } finally {
      terminate(applicationName);
      await holder.catch(() => undefined);
    }
  });

  it('cleanup_rate_limit_events conserva firma, retorno INTEGER y validaciones', () => {
    expect(
      sql("SELECT pg_get_function_result('public.cleanup_rate_limit_events(interval,integer)'::regprocedure);")
    ).toBe('integer');
    expect(
      sql("SELECT pg_get_function_result('public.cleanup_rate_limit_events_status(interval,integer)'::regprocedure);")
    ).toBe('jsonb');
    expect(
      sql("SELECT pg_get_function_result('public.cleanup_rate_limit_events_core(interval,integer)'::regprocedure);")
    ).toBe('jsonb');

    expectSqlError(
      "SELECT public.cleanup_rate_limit_events(INTERVAL '24 hours', 1000);",
      /retencion minima/i
    );
    expectSqlError(
      "SELECT public.cleanup_rate_limit_events_status(INTERVAL '24 hours', 1000);",
      /retencion minima/i
    );
    expectSqlError(
      "SELECT public.cleanup_rate_limit_events(INTERVAL '25 hours', 0);",
      /p_batch_size/i
    );
  });

  it('restringe EXECUTE de run_maintenance y de la limpieza a service_role', () => {
    const signatures = [
      'public.run_maintenance()',
      'public.cleanup_rate_limit_events_core(interval,integer)',
      'public.cleanup_rate_limit_events_status(interval,integer)',
      'public.cleanup_rate_limit_events(interval,integer)',
    ];

    for (const signature of signatures) {
      expect(sql(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`)).toBe('f');
      expect(sql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`)).toBe(
        'f'
      );
      expect(sql(`SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`)).toBe(
        't'
      );
    }

    expect(
      sql(
        "SELECT proconfig FROM pg_proc WHERE oid = 'public.run_maintenance()'::regprocedure;"
      )
    ).toContain('search_path=public, pg_temp');
    expect(
      sql(
        "SELECT prosecdef FROM pg_proc WHERE oid = 'public.run_maintenance()'::regprocedure;"
      )
    ).toBe('f');
  });
});
