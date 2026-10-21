import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-maintenance-runs-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

function sql(statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${statement.replace(/"/g, '\\"')}"`
  );
}

function firstRow(statement: string): string[] {
  const line = sql(statement)
    .split('\n')
    .map((value) => value.trim())
    .find(Boolean);
  return (line ?? '').split('|');
}

function sqlAs(role: string, statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SET ROLE ${role}; ${statement};"`
  )
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value && !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/.test(value))
    .join('\n');
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

function expectSqlAsError(role: string, statement: string, pattern: RegExp): void {
  let failed = false;
  try {
    sqlAs(role, statement);
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

describe('maintenance runs integration', () => {
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
  }, 300000);

  beforeEach(() => {
    sql('TRUNCATE public.maintenance_runs RESTART IDENTITY;');
  });

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('crea la tabla con columnas, defaults y tipos esperados', () => {
    expect(sql("SELECT to_regclass('public.maintenance_runs') IS NOT NULL;")).toBe('t');
    expect(
      sql(
        "SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_runs' AND column_name = 'status';"
      )
    ).toContain("'running'");
    expect(
      sql(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_runs' AND column_name = 'started_at';"
      )
    ).toBe('NO');
    expect(
      sql(
        "SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_runs' AND column_name = 'duration_ms';"
      )
    ).toBe('bigint');
    expect(
      sql(
        "SELECT generation_expression FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_runs' AND column_name = 'duration_ms';"
      )
    ).toContain('finished_at');
  });

  it('registra una ejecucion running sin duracion', () => {
    const [id, status, finishedIsNull, duration] = firstRow(
      'INSERT INTO public.maintenance_runs DEFAULT VALUES RETURNING id, status, finished_at IS NULL, duration_ms;'
    );

    expect(Number(id)).toBe(1);
    expect(status).toBe('running');
    expect(finishedIsNull).toBe('t');
    expect(duration).toBe('');
  });

  it('calcula duration_ms al completar y la actualiza al cambiar finished_at', () => {
    const [id] = firstRow('INSERT INTO public.maintenance_runs DEFAULT VALUES RETURNING id;');

    const [duration] = firstRow(
      `UPDATE public.maintenance_runs SET status = 'success', finished_at = started_at + INTERVAL '2500 milliseconds' WHERE id = ${Number(id)} RETURNING duration_ms;`
    );
    expect(Number(duration)).toBe(2500);

    const [exact] = firstRow(
      `INSERT INTO public.maintenance_runs (started_at, finished_at, status, expired_quota_reservations, reconciled_budget_reservations, deleted_rate_limit_events) VALUES ('2026-10-20 10:00:00+00', '2026-10-20 10:00:01.5+00', 'success', 2, 3, 4) RETURNING duration_ms;`
    );
    expect(Number(exact)).toBe(1500);
  });

  it('rechaza estados no permitidos', () => {
    expectSqlError(
      "INSERT INTO public.maintenance_runs (status, finished_at) VALUES ('unknown', clock_timestamp());",
      /check constraint/i
    );
  });

  it('exige coherencia entre status y finished_at', () => {
    expectSqlError(
      "INSERT INTO public.maintenance_runs (status, finished_at) VALUES ('running', clock_timestamp());",
      /chk_maintenance_finished_matches_status/
    );
    expectSqlError(
      "INSERT INTO public.maintenance_runs (status) VALUES ('success');",
      /chk_maintenance_finished_matches_status/
    );
  });

  it('rechaza finished_at anterior a started_at y contadores negativos', () => {
    expectSqlError(
      `INSERT INTO public.maintenance_runs (started_at, finished_at, status) VALUES (clock_timestamp(), clock_timestamp() - INTERVAL '1 second', 'success');`,
      /chk_maintenance_finished_after_started/
    );
    expectSqlError(
      'INSERT INTO public.maintenance_runs (expired_quota_reservations) VALUES (-1);',
      /check constraint/i
    );
    expectSqlError(
      'INSERT INTO public.maintenance_runs (reconciled_budget_reservations) VALUES (-1);',
      /check constraint/i
    );
    expectSqlError(
      'INSERT INTO public.maintenance_runs (deleted_rate_limit_events) VALUES (-1);',
      /check constraint/i
    );
  });

  it('exige error_details objeto y no vacio para partial o failed', () => {
    expectSqlError(
      "INSERT INTO public.maintenance_runs (status, finished_at) VALUES ('partial', clock_timestamp());",
      /chk_maintenance_failure_details/
    );
    expectSqlError(
      `INSERT INTO public.maintenance_runs (status, finished_at, error_details) VALUES ('failed', clock_timestamp(), '[]'::jsonb);`,
      /check constraint/i
    );

    const [details] = firstRow(
      `INSERT INTO public.maintenance_runs (status, finished_at, error_details) VALUES ('partial', clock_timestamp(), '{"cleanup_rate_limit_events":"timeout"}'::jsonb) RETURNING error_details->>'cleanup_rate_limit_events';`
    );
    expect(details).toBe('timeout');
  });

  it('mantiene RLS activa y niega lectura y escritura a anon y authenticated', () => {
    expect(
      sql("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.maintenance_runs'::regclass;")
    ).toBe('t');

    const statements = [
      'SELECT count(*) FROM public.maintenance_runs',
      'INSERT INTO public.maintenance_runs DEFAULT VALUES',
      'UPDATE public.maintenance_runs SET status = status',
      'DELETE FROM public.maintenance_runs',
    ];

    for (const role of ['anon', 'authenticated']) {
      for (const statement of statements) {
        let failed = false;
        try {
          exec(sqlAs(role, statement));
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : String(error);
          expect(message.toLowerCase()).toContain('permission denied');
        }
        expect(failed).toBe(true);
      }
    }
  });

  it('permite a service_role insertar y leer la auditoria', () => {
    const output = sqlAs(
      'service_role',
      `INSERT INTO public.maintenance_runs (status, finished_at, expired_quota_reservations, reconciled_budget_reservations, deleted_rate_limit_events) VALUES ('success', clock_timestamp(), 1, 2, 3) RETURNING id, status`
    );
    const [id, status] = output
      .split('\n')
      .map((value) => value.trim())
      .find(Boolean)!
      .split('|');

    expect(Number(id)).toBeGreaterThan(0);
    expect(status).toBe('success');
    expect(
      sqlAs('service_role', `SELECT count(*) FROM public.maintenance_runs WHERE id = ${Number(id)};`)
    ).toBe('1');
  });

  it('define privilegios efectivos minimos de service_role sobre la tabla', () => {
    const privileges = sql(
      "SELECT array_to_string(ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p WHERE has_table_privilege('service_role', 'public.maintenance_runs', p)), ',');"
    );
    expect(privileges).toBe('SELECT,INSERT,UPDATE');
  });

  it('permite a service_role actualizar y le niega DELETE sobre la tabla', () => {
    const [id] = firstRow('INSERT INTO public.maintenance_runs DEFAULT VALUES RETURNING id;');
    const [status, completed] = sqlAs(
      'service_role',
      `UPDATE public.maintenance_runs SET status = 'success', finished_at = started_at + INTERVAL '5 milliseconds' WHERE id = ${Number(id)} RETURNING status, duration_ms IS NOT NULL;`
    ).split('|');

    expect(status).toBe('success');
    expect(completed).toBe('t');

    expectSqlAsError(
      'service_role',
      `DELETE FROM public.maintenance_runs WHERE id = ${Number(id)};`,
      /permission denied/i
    );
    expect(
      sql(`SELECT count(*) FROM public.maintenance_runs WHERE id = ${Number(id)};`)
    ).toBe('1');
  });

  it('revoca USAGE y SELECT de la secuencia a anon y authenticated', () => {
    for (const role of ['anon', 'authenticated']) {
      expect(
        sql(
          `SELECT has_sequence_privilege('${role}', 'public.maintenance_runs_id_seq', 'USAGE');`
        )
      ).toBe('f');
      expect(
        sql(
          `SELECT has_sequence_privilege('${role}', 'public.maintenance_runs_id_seq', 'SELECT');`
        )
      ).toBe('f');
      expect(
        sql(
          `SELECT has_sequence_privilege('${role}', 'public.maintenance_runs_id_seq', 'UPDATE');`
        )
      ).toBe('f');
      expectSqlAsError(
        role,
        "SELECT nextval('public.maintenance_runs_id_seq')",
        /permission denied for sequence/i
      );
      expectSqlAsError(
        role,
        'SELECT last_value FROM public.maintenance_runs_id_seq',
        /permission denied for sequence/i
      );
    }

    expect(
      sql(
        "SELECT has_sequence_privilege('service_role', 'public.maintenance_runs_id_seq', 'USAGE') AND has_sequence_privilege('service_role', 'public.maintenance_runs_id_seq', 'SELECT');"
      )
    ).toBe('t');
    expect(
      sql(
        "SELECT has_sequence_privilege('service_role', 'public.maintenance_runs_id_seq', 'UPDATE');"
      )
    ).toBe('f');
  });

  it('expone run_maintenance despues de la migracion 025', () => {
    expect(sql("SELECT to_regprocedure('public.run_maintenance()') IS NOT NULL;")).toBe('t');
    expect(
      sql(
        "SELECT pg_get_function_result('public.run_maintenance()'::regprocedure);"
      )
    ).toBe('jsonb');
  });
});
