import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-privileges-test';
const PROBE_ROLE = 'vf_public_probe';

const TABLES = [
  'public.visitor_daily_quota',
  'public.quota_reservations',
  'public.generation_records',
  'public.budget_tracking',
];
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const SEQUENCES = [
  'public.visitor_daily_quota_id_seq',
  'public.quota_reservations_id_seq',
  'public.generation_records_id_seq',
  'public.budget_tracking_id_seq',
];
const SEQUENCE_PRIVILEGES = ['USAGE', 'SELECT', 'UPDATE'];

const RPC_SIGNATURES = [
  'public.reserve_quota(uuid,date,uuid)',
  'public.confirm_quota(uuid)',
  'public.release_quota(uuid)',
  'public.get_quota_status(uuid,date)',
  'public.mark_quota_sent(uuid)',
  'public.expire_pending_reservations()',
  'public.reserve_budget(uuid,varchar,numeric,numeric)',
  'public.confirm_budget(uuid,numeric,boolean)',
  'public.release_budget(uuid)',
  'public.get_budget_status(varchar,numeric)',
  'public.check_rate_limit(inet)',
  'public.reconcile_pending_budget_reservations(interval)',
  'public.cleanup_rate_limit_events(interval,integer)',
  'public.cleanup_rate_limit_events_core(interval,integer)',
  'public.cleanup_rate_limit_events_status(interval,integer)',
  'public.run_maintenance()',
];

const VISITOR_ONE = '11111111-1111-4111-8111-111111111111';
const VISITOR_TWO = '11111111-1111-4111-8111-111111111112';

let fixtureCounter = 0;

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 60000 }).trim();
}

function psql(statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${statement.replace(/"/g, '\\"')}"`
  );
}

function psqlAs(role: string, statement: string): string {
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

function runSqlScript(statements: string): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'vf-privileges-'));
  const file = `privileges-${fixtureCounter++}.sql`;
  const localPath = join(directory, file);

  writeFileSync(localPath, `${statements}\n`, 'utf8');
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

function runSqlAs(role: string, statements: string): string[] {
  return runSqlScript(`SET ROLE ${role};\n${statements}`);
}

function expectSqlAsError(role: string, statement: string, pattern: RegExp): void {
  let failed = false;
  try {
    psqlAs(role, statement);
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

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function copyMigrations(files: string[]): void {
  for (const file of files) {
    exec(`docker cp "${join(MIGRATIONS_DIR, file)}" ${CONTAINER_NAME}:/tmp/${file}`);
  }
}

function applyMigrations(files: string[]): void {
  for (const file of files) {
    exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f /tmp/${file}`);
  }
}

function setupSupabaseDefaults(): void {
  runSqlScript(
    `CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE ${PROBE_ROLE} NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, ${PROBE_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`
  );
}

function tablePrivileges(role: string, table: string): string[] {
  const privilegeList = TABLE_PRIVILEGES.map((privilege) => `'${privilege}'`).join(',');
  const value = psql(
    `SELECT array_to_string(ARRAY(SELECT p FROM unnest(ARRAY[${privilegeList}]) AS p WHERE has_table_privilege('${role}', '${table}', p)), ',');`
  );
  return value ? value.split(',').filter(Boolean) : [];
}

function sequencePrivileges(role: string, sequence: string): string[] {
  const privilegeList = SEQUENCE_PRIVILEGES.map((privilege) => `'${privilege}'`).join(',');
  const value = psql(
    `SELECT array_to_string(ARRAY(SELECT p FROM unnest(ARRAY[${privilegeList}]) AS p WHERE has_sequence_privilege('${role}', '${sequence}', p)), ',');`
  );
  return value ? value.split(',').filter(Boolean) : [];
}

function executableRpcCount(role: string): number {
  const signatureList = RPC_SIGNATURES.map((signature) => `'${signature}'`).join(',');
  return Number(
    psql(
      `SELECT count(*) FROM unnest(ARRAY[${signatureList}]) AS s WHERE has_function_privilege('${role}', s, 'EXECUTE');`
    )
  );
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

function truncateAll(): void {
  psql(
    'TRUNCATE public.maintenance_runs, public.quota_reservations, public.generation_records, public.visitor_daily_quota, public.budget_reservations, public.budget_tracking, public.ip_rate_limit_events RESTART IDENTITY CASCADE;'
  );
}

let before026: Record<string, string> = {};
let after026: Record<string, string> = {};

function snapshot(): Record<string, string> {
  return {
    anonQuotaReservationsSelect: psql(
      "SELECT has_table_privilege('anon', 'public.quota_reservations', 'SELECT');"
    ),
    anonQuotaReservationsTruncate: psql(
      "SELECT has_table_privilege('anon', 'public.quota_reservations', 'TRUNCATE');"
    ),
    authenticatedBudgetTrackingSelect: psql(
      "SELECT has_table_privilege('authenticated', 'public.budget_tracking', 'SELECT');"
    ),
    anonGenerationRecordsInsert: psql(
      "SELECT has_table_privilege('anon', 'public.generation_records', 'INSERT');"
    ),
    anonQuotaReservationsSeqUsage: psql(
      "SELECT has_sequence_privilege('anon', 'public.quota_reservations_id_seq', 'USAGE');"
    ),
    anonReserveQuotaExecute: psql(
      "SELECT has_function_privilege('anon', 'public.reserve_quota(uuid,date,uuid)', 'EXECUTE');"
    ),
    authenticatedGetQuotaStatusExecute: psql(
      "SELECT has_function_privilege('authenticated', 'public.get_quota_status(uuid,date)', 'EXECUTE');"
    ),
    serviceRoleQuotaReservationsDelete: psql(
      "SELECT has_table_privilege('service_role', 'public.quota_reservations', 'DELETE');"
    ),
    probeQuotaReservationsSelect: psql(
      `SELECT has_table_privilege('${PROBE_ROLE}', 'public.quota_reservations', 'SELECT');`
    ),
  };
}

describe('privilegios minimos (026) en harness con defaults de Supabase', () => {
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

    setupSupabaseDefaults();

    const files = migrationFiles();
    copyMigrations(files);

    const pre = files.filter((file) => !file.startsWith('026_'));
    applyMigrations(pre);
    before026 = snapshot();

    const migration026 = files.filter((file) => file.startsWith('026_'));
    applyMigrations(migration026);
    after026 = snapshot();
  }, 300000);

  beforeEach(() => {
    truncateAll();
  });

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('los defaults de Supabase otorgaban privilegios excesivos antes de 026', () => {
    expect(before026.anonQuotaReservationsSelect).toBe('t');
    expect(before026.anonQuotaReservationsTruncate).toBe('t');
    expect(before026.authenticatedBudgetTrackingSelect).toBe('t');
    expect(before026.anonGenerationRecordsInsert).toBe('t');
    expect(before026.anonQuotaReservationsSeqUsage).toBe('t');
    expect(before026.anonReserveQuotaExecute).toBe('t');
    expect(before026.authenticatedGetQuotaStatusExecute).toBe('t');
    expect(before026.serviceRoleQuotaReservationsDelete).toBe('t');
  });

  it('026 corrige el escenario: anon y authenticated pierden los privilegios excesivos', () => {
    expect(after026.anonQuotaReservationsSelect).toBe('f');
    expect(after026.anonQuotaReservationsTruncate).toBe('f');
    expect(after026.authenticatedBudgetTrackingSelect).toBe('f');
    expect(after026.anonGenerationRecordsInsert).toBe('f');
    expect(after026.anonQuotaReservationsSeqUsage).toBe('f');
    expect(after026.anonReserveQuotaExecute).toBe('f');
    expect(after026.authenticatedGetQuotaStatusExecute).toBe('f');
    expect(after026.serviceRoleQuotaReservationsDelete).toBe('f');
  });

  it('anon, authenticated y PUBLIC no tienen privilegios de tabla sobre las cuatro tablas', () => {
    for (const role of ['anon', 'authenticated', PROBE_ROLE]) {
      for (const table of TABLES) {
        expect(tablePrivileges(role, table)).toEqual([]);
      }
    }
  });

  it('anon, authenticated y PUBLIC no tienen privilegios sobre las secuencias asociadas', () => {
    for (const role of ['anon', 'authenticated', PROBE_ROLE]) {
      for (const sequence of SEQUENCES) {
        expect(sequencePrivileges(role, sequence)).toEqual([]);
      }
    }
  });

  it('service_role conserva solo los privilegios de tabla minimos y verificados', () => {
    expect(tablePrivileges('service_role', 'public.visitor_daily_quota')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
    ]);
    expect(tablePrivileges('service_role', 'public.quota_reservations')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
    ]);
    expect(tablePrivileges('service_role', 'public.generation_records')).toEqual(['SELECT', 'INSERT']);
    expect(tablePrivileges('service_role', 'public.budget_tracking')).toEqual([
      'SELECT',
      'INSERT',
      'UPDATE',
    ]);
  });

  it('service_role solo tiene USAGE sobre las secuencias asociadas', () => {
    for (const sequence of SEQUENCES) {
      expect(sequencePrivileges('service_role', sequence)).toEqual(['USAGE']);
    }
  });

  it('las RPC del backend se restringen a service_role (EXECUTE efectivo)', () => {
    expect(executableRpcCount('service_role')).toBe(RPC_SIGNATURES.length);
    expect(executableRpcCount('anon')).toBe(0);
    expect(executableRpcCount('authenticated')).toBe(0);
    expect(executableRpcCount(PROBE_ROLE)).toBe(0);
  });

  it('RLS sigue activa sin politicas en las cuatro tablas', () => {
    for (const table of TABLES) {
      expect(psql(`SELECT relrowsecurity FROM pg_class WHERE oid = '${table}'::regclass;`)).toBe('t');
    }
    expect(
      psql(
        `SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('visitor_daily_quota','quota_reservations','generation_records','budget_tracking');`
      )
    ).toBe('0');
  });

  it('los flujos legitimos del backend se ejecutan con service_role', () => {
    const visitor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const reservation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const budgetReservation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    expect(
      psqlAs(
        'service_role',
        `SELECT public.reserve_quota('${visitor}'::uuid, current_date, '${reservation}'::uuid) ->> 'status'`
      )
    ).toBe('reserved');
    expect(
      psqlAs(
        'service_role',
        `SELECT public.get_quota_status('${visitor}'::uuid, current_date) ->> 'generations_used'`
      )
    ).toBe('1');
    expect(
      psqlAs('service_role', `SELECT public.mark_quota_sent('${reservation}'::uuid) ->> 'status'`)
    ).toBe('sent');
    expect(
      psqlAs('service_role', `SELECT public.confirm_quota('${reservation}'::uuid) ->> 'status'`)
    ).toBe('confirmed');

    psqlAs(
      'service_role',
      `INSERT INTO public.generation_records (visitor_id, reservation_id, success, estimated_cost_usd) VALUES ('${visitor}'::uuid, '${reservation}'::uuid, true, 0)`
    );

    expect(
      psqlAs(
        'service_role',
        `SELECT public.reserve_budget('${budgetReservation}'::uuid, to_char(current_date,'YYYY-MM'), 0.10, 5.00) ->> 'status'`
      )
    ).toBe('reserved');
    expect(
      psqlAs(
        'service_role',
        `SELECT public.get_budget_status(to_char(current_date,'YYYY-MM'), 5.00) ->> 'month'`
      )
    ).toMatch(/^\d{4}-\d{2}$/);
    expect(
      psqlAs(
        'service_role',
        `SELECT public.confirm_budget('${budgetReservation}'::uuid, 0.08, false) ->> 'status'`
      )
    ).toBe('confirmed');
    expect(
      psqlAs('service_role', `SELECT public.check_rate_limit('198.51.100.7'::inet) ->> 'status'`)
    ).toBe('allowed');
  });

  it('run_maintenance termina en success con service_role', () => {
    runSqlScript(seedMantenimiento);
    const output = runSqlAs('service_role', 'SELECT public.run_maintenance();');
    const result = JSON.parse(output[output.length - 1]) as Record<string, unknown>;

    expect(result.status).toBe('success');
    expect(result.expired_quota_reservations).toBe(2);
    expect(result.reconciled_budget_reservations).toBe(1);
    expect(result.deleted_rate_limit_events).toBe(3);
    expect(result.error_details).toEqual({});
  });

  it('anon y authenticated no pueden ejecutar run_maintenance ni reserve_quota', () => {
    expectSqlAsError(
      'anon',
      'SELECT public.run_maintenance()',
      /permission denied for function run_maintenance/i
    );
    expectSqlAsError(
      'authenticated',
      'SELECT public.reserve_quota(gen_random_uuid(), current_date, gen_random_uuid())',
      /permission denied for function reserve_quota/i
    );
  });

  it('anon no puede insertar en las tablas ni truncarlas pese a RLS', () => {
    expectSqlAsError(
      'anon',
      `INSERT INTO public.generation_records (visitor_id, success, estimated_cost_usd) VALUES ('${VISITOR_ONE}'::uuid, true, 0)`,
      /permission denied for table generation_records/i
    );
    expectSqlAsError('anon', 'TRUNCATE public.quota_reservations', /permission denied for table/i);
  });
});
