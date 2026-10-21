import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-reconciliation-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 50000 }).trim();
}

function query(sql: string): string {
  return exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${sql.replace(/"/g, '\\"')}"`);
}

function runSqlFile(file: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -q -t -A -f /tmp/${file}`
  );
}

function applyFixture(name: string, sql: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'vf-recon-'));
  const file = `${name}.sql`;
  writeFileSync(join(directory, file), sql, 'utf8');
  exec(`docker cp "${join(directory, file)}" ${CONTAINER_NAME}:/tmp/${file}`);
  const result = runSqlFile(file);
  rmSync(directory, { recursive: true, force: true });
  return result;
}

function rows(sql: string, name = 'fixture'): string[] {
  return applyFixture(name, sql)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

describe('reconciliation integration', () => {
  beforeAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }

    exec(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpass123 -e POSTGRES_DB=testdb -d postgres:17-alpine`
    );

    let ready = false;
    let consecutive = 0;
    for (let i = 0; i < 120 && consecutive < 3; i++) {
      // El entrypoint de postgres levanta un servidor efimero para el setup y luego
      // lo reinicia: una consulta real exige 3 respuestas seguidas para confirmar
      // que el servidor quedo estable.
      consecutive = probeDatabase() === '1' ? consecutive + 1 : 0;
      if (consecutive < 3) {
        execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore' });
      }
    }
    ready = consecutive >= 3;

    if (!ready) {
      throw new Error('PostgreSQL no se pudo iniciar');
    }

    // Roles de Supabase para verificar permisos en tiempo de ejecucion.
    exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"`
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((item) => item.endsWith('.sql'))
      .sort();

    for (const file of files) {
      exec(`docker cp "${join(MIGRATIONS_DIR, file)}" ${CONTAINER_NAME}:/tmp/${file}`);
      exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f /tmp/${file}`);
    }
  }, 300000);

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('successful pending quota reservation is not released by expiration', () => {
    const visitorId = '9198b54a-c7b8-49ff-8709-6d6d258f5551';
    const reservationId = '6f6f6f00-0101-4a10-8709-6d6d258f5551';

    applyFixture('successful-quota-reconciliation', `
      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes');

      INSERT INTO generation_records (visitor_id, reservation_id, success)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, true);
    `);

    const expired = query("SELECT expire_pending_reservations()");
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`);

    expect(Number(expired.trim())).toBe(0);
    expect(status.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  });

  it('pending quota reservation without a success record is expired and released', () => {
    const visitorId = '9298b54a-c7b8-49ff-8709-6d6d258f5552';
    const reservationId = '7f6f6f00-0202-4a10-8709-6d6d258f5552';

    applyFixture('failed-quota-reconciliation', `
      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes');
    `);

    const expired = query("SELECT expire_pending_reservations()");
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`);

    expect(Number(expired.trim())).toBe(1);
    expect(status.trim()).toBe('expired');
    expect(Number(used.trim())).toBe(0);
  });

  it('expire_pending_reservations releases one unit per reservation of the same visitor and date', () => {
    const visitorId = 'a198b54a-c7b8-49ff-8709-6d6d258f5560';
    const reservationIds = [
      'a16f6f00-1000-4a10-8709-6d6d258f5560',
      'a26f6f00-1001-4a10-8709-6d6d258f5560',
      'a36f6f00-1002-4a10-8709-6d6d258f5560',
    ];

    applyFixture(
      'grouped-expiration',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 3, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ${reservationIds
        .map(
          (id) =>
            `('${visitorId}'::uuid, '${id}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes')`
        )
        .join(',\n      ')};`
    );

    const expired = query('SELECT expire_pending_reservations()');
    const used = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );
    const statuses = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM quota_reservations WHERE reservation_id IN (${reservationIds
        .map((id) => `'${id}'::uuid`)
        .join(', ')})`
    );

    expect(Number(expired.trim())).toBe(3);
    expect(Number(used.trim())).toBe(0);
    expect(statuses.trim()).toBe('expired,expired,expired');
  });

  it('expire_pending_reservations groups by visitor and by date', () => {
    const firstVisitor = 'b198b54a-c7b8-49ff-8709-6d6d258f5561';
    const secondVisitor = 'c298b54a-c7b8-49ff-8709-6d6d258f5562';

    applyFixture(
      'grouped-by-visitor-and-date',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${firstVisitor}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 2, 5),
             ('${secondVisitor}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 2, 5),
             ('${firstVisitor}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE - 1, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${firstVisitor}'::uuid, 'b16f6f00-2000-4a10-8709-6d6d258f5561'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${firstVisitor}'::uuid, 'b26f6f00-2001-4a10-8709-6d6d258f5561'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${secondVisitor}'::uuid, 'c16f6f00-2002-4a10-8709-6d6d258f5562'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${secondVisitor}'::uuid, 'c26f6f00-2003-4a10-8709-6d6d258f5562'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${firstVisitor}'::uuid, 'b36f6f00-2004-4a10-8709-6d6d258f5561'::uuid, 'pending', NOW() - INTERVAL '1 day 2 hours', NOW() - INTERVAL '1 day 1 hour');`
    );

    const expired = query('SELECT expire_pending_reservations()');
    const today = query(
      `SELECT (SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${firstVisitor}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE) || '|' || (SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${secondVisitor}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE) || '|' || (SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${firstVisitor}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE - 1)`
    );

    expect(Number(expired.trim())).toBe(5);
    expect(today.split('|').map((value) => Number(value.trim()))).toEqual([0, 0, 0]);
  });

  it('running expiration twice does not release quota twice', () => {
    const visitorId = 'd398b54a-c7b8-49ff-8709-6d6d258f5563';
    const reservationId = 'd16f6f00-3000-4a10-8709-6d6d258f5563';

    applyFixture(
      'idempotent-expiration',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 2, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes');`
    );

    const first = query('SELECT expire_pending_reservations()');
    const usedAfterFirst = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );
    const second = query('SELECT expire_pending_reservations()');
    const usedAfterSecond = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );

    expect(Number(first.trim())).toBe(1);
    expect(Number(usedAfterFirst.trim())).toBe(1);
    expect(Number(second.trim())).toBe(0);
    expect(Number(usedAfterSecond.trim())).toBe(1);
  });

  it('concurrent expiration and confirmation keep the quota consistent', async () => {
    const visitorId = 'e498b54a-c7b8-49ff-8709-6d6d258f5564';
    const expiredReservation = 'e16f6f00-4000-4a10-8709-6d6d258f5564';
    const confirmedReservation = 'e26f6f00-4001-4a10-8709-6d6d258f5564';

    applyFixture(
      'concurrent-expiration-confirmation',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 2, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${expiredReservation}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${visitorId}'::uuid, '${confirmedReservation}'::uuid, 'pending', NOW(), NOW() + INTERVAL '5 minutes');`
    );

    const [expiration, confirmation] = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT expire_pending_reservations();"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT confirm_quota('${confirmedReservation}'::uuid);"`
      ),
    ]);

    const expiredStatus = query(
      `SELECT status FROM quota_reservations WHERE reservation_id = '${expiredReservation}'::uuid`
    );
    const confirmedStatus = query(
      `SELECT status FROM quota_reservations WHERE reservation_id = '${confirmedReservation}'::uuid`
    );
    const used = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );

    expect(Number(expiration.stdout.trim())).toBe(1);
    expect(confirmation.stdout).toContain('"confirmed"');
    expect(expiredStatus.trim()).toBe('expired');
    expect(confirmedStatus.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  }, 60000);

  it('expire_pending_reservations is restricted to service_role', () => {
    expect(
      query(`SELECT has_function_privilege('anon', 'public.expire_pending_reservations()', 'EXECUTE');`).trim()
    ).toBe('f');
    expect(
      query(
        `SELECT has_function_privilege('authenticated', 'public.expire_pending_reservations()', 'EXECUTE');`
      ).trim()
    ).toBe('f');
    expect(
      query(`SELECT has_function_privilege('service_role', 'public.expire_pending_reservations()', 'EXECUTE');`).trim()
    ).toBe('t');
    expect(query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quota_reservations'::regclass;").trim()).toBe(
      't'
    );
  });

  it('mark_quota_sent moves a pending reservation to sent_uncertain once', () => {
    const visitorId = '9398b54a-c7b8-49ff-8709-6d6d258f5553';
    const reservationId = '8f6f6f00-0303-4a10-8709-6d6d258f5553';

    applyFixture('mark-quota-sent', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '10 minutes');
    `);

    const first = query(`SELECT mark_quota_sent('${reservationId}'::uuid)`);
    const second = query(`SELECT mark_quota_sent('${reservationId}'::uuid)`);
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);

    expect(first.trim()).toContain('"sent"');
    expect(second.trim()).toContain('"already_sent"');
    expect(status.trim()).toBe('sent_uncertain');
  });

  it('expire_pending_reservations never releases a sent_uncertain reservation', () => {
    const visitorId = '9498b54a-c7b8-49ff-8709-6d6d258f5554';
    const reservationId = '9f6f6f00-0404-4a10-8709-6d6d258f5554';

    // Siembra, expiracion y lectura en una sola transicion: el estado y el
    // contador observados corresponden al mismo instante, sin depender de
    // sesiones separadas.
    const [expired, status, used] = rows(`
      BEGIN;

      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes');

      SELECT expire_pending_reservations();
      SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid;
      SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;

      COMMIT;
    `, 'uncertain-quota-reconciliation');

    expect(Number(expired)).toBe(0);
    expect(status).toBe('sent_uncertain');
    expect(Number(used)).toBe(1);
  });

  it('expire_pending_reservations completes an uncertain reservation with a success record', () => {
    const visitorId = '9598b54a-c7b8-49ff-8709-6d6d258f5555';
    const reservationId = 'af6f6f00-0505-4a10-8709-6d6d258f5555';

    // Siembra, expiracion y lectura en una sola transicion: el registro de
    // generacion exitosa y la reserva incierta quedan inconsistencies.
    const [expired, status, used] = rows(`
      BEGIN;

      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes');

      INSERT INTO generation_records (visitor_id, reservation_id, success)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, true);

      SELECT expire_pending_reservations();
      SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid;
      SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE;

      COMMIT;
    `, 'uncertain-quota-success');

    expect(Number(expired)).toBe(0);
    expect(status).toBe('completed');
    expect(Number(used)).toBe(1);
  });

  it('confirm_quota confirms an uncertain reservation only once', () => {
    const visitorId = '9698b54a-c7b8-49ff-8709-6d6d258f5556';
    const reservationId = 'bf6f6f00-0606-4a10-8709-6d6d258f5556';

    applyFixture('uncertain-quota-confirm', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '10 minutes');
    `);

    const first = query(`SELECT confirm_quota('${reservationId}'::uuid)`);
    const second = query(`SELECT confirm_quota('${reservationId}'::uuid)`);
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`);

    expect(first.trim()).toContain('"confirmed"');
    expect(second.trim()).toContain('"already_processed"');
    expect(status.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  });

  it('release_quota releases an uncertain reservation on a definitive provider failure', () => {
    const visitorId = '9798b54a-c7b8-49ff-8709-6d6d258f5557';
    const reservationId = 'cf6f6f00-0707-4a10-8709-6d6d258f5557';

    applyFixture('uncertain-quota-release', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '10 minutes');
    `);

    const released = query(`SELECT release_quota('${reservationId}'::uuid)`);
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`);

    expect(released.trim()).toContain('"released"');
    expect(status.trim()).toBe('released');
    expect(Number(used.trim())).toBe(0);
  });

  it('reconcile_pending_budget_reservations confirms an old reserved row idempotently', () => {
    const reservationId = 'ffffffff-1111-4aaa-8bbb-ccccdddd0000';
    const month = new Date().toISOString().slice(0, 7);

    applyFixture('budget-reconciliation', `
      INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 1.2)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${reservationId}'::uuid, '${month}', 'reserved', 1.2, 0, true, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes');
    `);

    const first = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const second = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const status = query(`SELECT status FROM budget_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const tracking = query(`SELECT reserved_usd, spent_usd FROM budget_tracking WHERE month = '${month}'`);

    expect(Number(first.trim())).toBe(1);
    expect(Number(second.trim())).toBe(0);
    expect(status.trim()).toBe('confirmed');
    expect(tracking.trim()).toBe('0.000000|1.200000');
  });

  it('reconcile_pending_budget_reservations charges the exact sum per budget period', () => {
    const month = new Date().toISOString().slice(0, 7);
    const first = 'ffffffff-1111-4aaa-8bbb-ccccdddd1001';
    const second = 'ffffffff-1111-4aaa-8bbb-ccccdddd1002';
    const third = 'ffffffff-1111-4aaa-8bbb-ccccdddd1003';

    applyFixture(
      'budget-reconciliation-sum',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 3.0)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${first}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${second}'::uuid, '${month}', 'reserved', 2.0, 0, false, NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '40 minutes'),
             ('${third}'::uuid, '${month}', 'reserved', 0.5, 0, false, NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '50 minutes');`
    );

    const reconciled = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const tracking = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );
    const costs = query(
      `SELECT string_agg(status || ':' || actual_cost_usd || ':' || cost_estimated, ',' ORDER BY reservation_id) FROM budget_reservations WHERE reservation_id IN ('${first}'::uuid, '${second}'::uuid, '${third}'::uuid)`
    );

    expect(Number(reconciled.trim())).toBe(3);
    expect(tracking.trim()).toBe('3.500000|0.000000');
    expect(costs.trim().split(',').sort()).toEqual([
      'confirmed:0.500000:true',
      'confirmed:1.000000:true',
      'confirmed:2.000000:true',
    ]);
  });

  it('reconcile_pending_budget_reservations keeps reservations that are not eligible yet', () => {
    const month = new Date().toISOString().slice(0, 7);
    const stale = 'ffffffff-1111-4aaa-8bbb-ccccdddd2001';
    const fresh = 'ffffffff-1111-4aaa-8bbb-ccccdddd2002';

    applyFixture(
      'budget-reconciliation-eligibility',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 2.0)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${stale}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${fresh}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes');`
    );

    const reconciled = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const statuses = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM budget_reservations WHERE reservation_id IN ('${stale}'::uuid, '${fresh}'::uuid)`
    );
    const tracking = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );

    expect(Number(reconciled.trim())).toBe(1);
    expect(statuses.trim()).toBe('confirmed,reserved');
    expect(tracking.trim()).toBe('1.000000|1.000000');
  });

  it('reconcile_pending_budget_reservations handles different budget periods independently', () => {
    const month = new Date().toISOString().slice(0, 7);
    const previousMonth = new Date(Date.UTC(2026, 0, 15)).toISOString().slice(0, 7);
    const currentReservation = 'ffffffff-1111-4aaa-8bbb-ccccdddd3001';
    const previousReservation = 'ffffffff-1111-4aaa-8bbb-ccccdddd3002';

    applyFixture(
      'budget-reconciliation-periods',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 1.5),
             ('${previousMonth}', 0, 0.75)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${currentReservation}'::uuid, '${month}', 'reserved', 1.5, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${previousReservation}'::uuid, '${previousMonth}', 'reserved', 0.75, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes');`
    );

    const reconciled = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const current = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );
    const previous = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${previousMonth}'`
    );

    expect(Number(reconciled.trim())).toBe(2);
    expect(current.trim()).toBe('1.500000|0.000000');
    expect(previous.trim()).toBe('0.750000|0.000000');
  });

  it('concurrent reconciliations confirm each reservation only once', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const first = 'ffffffff-1111-4aaa-8bbb-ccccdddd4001';
    const second = 'ffffffff-1111-4aaa-8bbb-ccccdddd4002';

    applyFixture(
      'budget-reconciliation-concurrent',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 2.5)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${first}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${second}'::uuid, '${month}', 'reserved', 1.5, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes');`
    );

    const results = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reconcile_pending_budget_reservations('15 minutes'::interval);"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reconcile_pending_budget_reservations('15 minutes'::interval);"`
      ),
    ]);

    const counts = results.map((result) => Number(result.stdout.trim()));
    const tracking = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );
    const confirmed = query(
      `SELECT count(*) FROM budget_reservations WHERE reservation_id IN ('${first}'::uuid, '${second}'::uuid) AND status = 'confirmed'`
    );

    expect(counts.reduce((total, value) => total + value, 0)).toBe(2);
    expect(tracking.trim()).toBe('2.500000|0.000000');
    expect(Number(confirmed.trim())).toBe(2);
  }, 60000);

  it('concurrent reconciliation and confirm or release keep the budget consistent', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const stale = 'ffffffff-1111-4aaa-8bbb-ccccdddd5001';
    const fresh = 'ffffffff-1111-4aaa-8bbb-ccccdddd5002';

    applyFixture(
      'budget-reconciliation-with-confirm',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 2.0)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${stale}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${fresh}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes');`
    );

    const [reconciliation, confirmation] = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reconcile_pending_budget_reservations('15 minutes'::interval);"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT confirm_budget('${fresh}'::uuid, 0.25, false);"`
      ),
    ]);

    const tracking = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );
    const rows = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM budget_reservations WHERE reservation_id IN ('${stale}'::uuid, '${fresh}'::uuid)`
    );

    // Una de las dos transacciones gana la reserva y la otra es idempotente. El
    // resultado final depende del orden, pero nunca se contabiliza dos veces:
    // si gana la conciliacion se cobran 2.0 (todo reservado), si gana la
    // confirmacion se cobran 1.25 (0.25 reales + 1.0 reservado de la vencida).
    const reconciled = Number(reconciliation.stdout.trim());
    const alreadyProcessed = confirmation.stdout.includes('already_processed');

    expect([1, 2]).toContain(reconciled);
    expect(alreadyProcessed).toBe(reconciled === 2);
    expect(tracking.trim()).toBe(reconciled === 2 ? '2.000000|0.000000' : '1.250000|0.000000');
    expect(rows.trim()).toBe('confirmed,confirmed');
  }, 60000);

  it('concurrent reconciliation and release keep the released amount out of spent', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const stale = 'ffffffff-1111-4aaa-8bbb-ccccdddd6001';
    const released = 'ffffffff-1111-4aaa-8bbb-ccccdddd6002';

    applyFixture(
      'budget-reconciliation-with-release',
      `INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 2.0)
      ON CONFLICT (month) DO UPDATE SET spent_usd = EXCLUDED.spent_usd, reserved_usd = EXCLUDED.reserved_usd;

      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${stale}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
             ('${released}'::uuid, '${month}', 'reserved', 1.0, 0, false, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes');`
    );

    const [reconciliation, release] = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reconcile_pending_budget_reservations('15 minutes'::interval);"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT release_budget('${released}'::uuid);"`
      ),
    ]);

    const tracking = query(
      `SELECT spent_usd || '|' || reserved_usd FROM budget_tracking WHERE month = '${month}'`
    );
    const statuses = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM budget_reservations WHERE reservation_id IN ('${stale}'::uuid, '${released}'::uuid)`
    );

    // Si la liberacion gana, esa reserva queda released y no se contabiliza; si gana
    // la conciliacion, release_budget es idempotente y el gasto es el reservado.
    // En ningun caso la misma reserva se contabiliza dos veces.
    const reconciled = Number(reconciliation.stdout.trim());
    const wasReleased = release.stdout.includes('"released"');

    expect([1, 2]).toContain(reconciled);
    expect(wasReleased).toBe(reconciled === 1);
    expect(tracking.trim()).toBe(reconciled === 1 ? '1.000000|0.000000' : '2.000000|0.000000');
    expect(statuses.trim()).toBe(reconciled === 1 ? 'confirmed,released' : 'confirmed,confirmed');
  }, 60000);

  it('reconcile_pending_budget_reservations is restricted to service_role', () => {
    expect(
      query(
        `SELECT has_function_privilege('anon', 'public.reconcile_pending_budget_reservations(interval)', 'EXECUTE');`
      ).trim()
    ).toBe('f');
    expect(
      query(
        `SELECT has_function_privilege('authenticated', 'public.reconcile_pending_budget_reservations(interval)', 'EXECUTE');`
      ).trim()
    ).toBe('f');
    expect(
      query(
        `SELECT has_function_privilege('service_role', 'public.reconcile_pending_budget_reservations(interval)', 'EXECUTE');`
      ).trim()
    ).toBe('t');
    expect(
      query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.budget_reservations'::regclass;").trim()
    ).toBe('t');
  });

  it('confirm_quota started before the reservation was created keeps completed_at >= created_at', async () => {
    const visitorId = 'f198b54a-c7b8-49ff-8709-6d6d258f5570';
    const reservationId = 'f16f6f00-7000-4a10-8709-6d6d258f5570';

    applyFixture('long-transaction-confirm-cleanup', `
      DELETE FROM generation_records;
      DELETE FROM quota_reservations;
    `);

    const confirmation = execAsync(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "BEGIN; SELECT pg_sleep(4); SELECT confirm_quota('${reservationId}'::uuid); COMMIT;"`
    );

    await sleep(1000);

    applyFixture('long-transaction-confirm-insert', `
      INSERT INTO quota_reservations (visitor_id, reservation_id, status, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() + INTERVAL '5 minutes');
    `);

    const result = await confirmation;
    const state = query(
      `SELECT status || '|' || (completed_at >= created_at) FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`
    );

    expect(result.stdout).toContain('"confirmed"');
    expect(state.trim()).toBe('completed|true');
  }, 60000);

  it('release_quota started before the reservation was created keeps completed_at >= created_at', async () => {
    const visitorId = 'f298b54a-c7b8-49ff-8709-6d6d258f5571';
    const reservationId = 'f26f6f00-7001-4a10-8709-6d6d258f5571';

    applyFixture('long-transaction-release-cleanup', `
      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO UPDATE SET generations_used = EXCLUDED.generations_used;
    `);

    const release = execAsync(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "BEGIN; SELECT pg_sleep(4); SELECT release_quota('${reservationId}'::uuid); COMMIT;"`
    );

    await sleep(1000);

    applyFixture('long-transaction-release-insert', `
      INSERT INTO quota_reservations (visitor_id, reservation_id, status, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() + INTERVAL '5 minutes');
    `);

    const result = await release;
    const state = query(
      `SELECT status || '|' || (completed_at >= created_at) FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`
    );
    const used = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );

    expect(result.stdout).toContain('"released"');
    expect(state.trim()).toBe('released|true');
    expect(Number(used.trim())).toBe(0);
  }, 60000);

  it('expire_pending_reservations expires several reservations created during a long transaction', async () => {
    const visitorId = 'f398b54a-c7b8-49ff-8709-6d6d258f5572';
    const reservationIds = [
      'f36f6f00-7002-4a10-8709-6d6d258f5572',
      'f46f6f00-7003-4a10-8709-6d6d258f5572',
      'f56f6f00-7004-4a10-8709-6d6d258f5572',
    ];

    applyFixture('long-transaction-expire-cleanup', `
      DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 3, 5)
      ON CONFLICT (visitor_id, quota_date) DO UPDATE SET generations_used = EXCLUDED.generations_used;
    `);

    const expiration = execAsync(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "BEGIN; SELECT pg_sleep(5); SELECT expire_pending_reservations(); COMMIT;"`
    );

    await sleep(1000);

    applyFixture(
      'long-transaction-expire-insert',
      `INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ${reservationIds
        .map(
          (id) =>
            `('${visitorId}'::uuid, '${id}'::uuid, 'pending', NOW(), NOW() + INTERVAL '1 second')`
        )
        .join(',\n      ')};`
    );

    const result = await expiration;
    const statuses = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM quota_reservations WHERE reservation_id IN (${reservationIds
        .map((id) => `'${id}'::uuid`)
        .join(', ')})`
    );
    const ordering = query(
      `SELECT bool_and(completed_at >= created_at) FROM quota_reservations WHERE reservation_id IN (${reservationIds
        .map((id) => `'${id}'::uuid`)
        .join(', ')})`
    );
    const used = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );

    const expiredCount = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\d+$/.test(line))
      .map(Number)[0];

    expect(expiredCount).toBe(3);
    expect(statuses.trim()).toBe('expired,expired,expired');
    expect(ordering.trim()).toBe('t');
    expect(Number(used.trim())).toBe(0);
  }, 60000);

  it('concurrent confirmation, release and expiration keep the quota and the timestamps consistent', async () => {
    const visitorId = 'f698b54a-c7b8-49ff-8709-6d6d258f5573';
    const expiredReservation = 'f66f6f00-7005-4a10-8709-6d6d258f5573';
    const confirmedReservation = 'f76f6f00-7006-4a10-8709-6d6d258f5573';
    const releasedReservation = 'f86f6f00-7007-4a10-8709-6d6d258f5573';

    applyFixture(
      'concurrent-confirm-release-expire',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 3, 5)
      ON CONFLICT (visitor_id, quota_date) DO UPDATE SET generations_used = EXCLUDED.generations_used;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${expiredReservation}'::uuid, 'pending', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes'),
             ('${visitorId}'::uuid, '${confirmedReservation}'::uuid, 'pending', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '10 minutes'),
             ('${visitorId}'::uuid, '${releasedReservation}'::uuid, 'pending', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '10 minutes');`
    );

    const [expiration, confirmation, release] = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT expire_pending_reservations();"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT confirm_quota('${confirmedReservation}'::uuid);"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT release_quota('${releasedReservation}'::uuid);"`
      ),
    ]);

    const statuses = query(
      `SELECT string_agg(status, ',' ORDER BY reservation_id) FROM quota_reservations WHERE reservation_id IN ('${expiredReservation}'::uuid, '${confirmedReservation}'::uuid, '${releasedReservation}'::uuid)`
    );
    const ordering = query(
      `SELECT bool_and(completed_at >= created_at) FROM quota_reservations WHERE reservation_id IN ('${expiredReservation}'::uuid, '${confirmedReservation}'::uuid, '${releasedReservation}'::uuid)`
    );
    const used = query(
      `SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = (NOW() AT TIME ZONE 'America/Mexico_City')::DATE`
    );

    expect(Number(expiration.stdout.trim())).toBe(1);
    expect(confirmation.stdout).toContain('"confirmed"');
    expect(release.stdout).toContain('"released"');
    expect(statuses.trim()).toBe('expired,completed,released');
    expect(ordering.trim()).toBe('t');
    expect(Number(used.trim())).toBe(1);
  }, 60000);

  it('transition timestamps never precede created_at when the wall clock is behind', () => {
    const visitorId = 'fb98b54a-c7b8-49ff-8709-6d6d258f5576';
    const confirmedReservation = 'fb6f6f00-7010-4a10-8709-6d6d258f5576';
    const releasedReservation = 'fc6f6f00-7011-4a10-8709-6d6d258f5576';

    // created_at en el futuro simula un retroceso del reloj de pared entre la
    // creacion de la reserva y la transicion: el GREATEST debe acotar
    // completed_at sin violar chk_completed_after_created.
    applyFixture(
      'clock-regression-guard',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, ((NOW() + INTERVAL '1 hour') AT TIME ZONE 'America/Mexico_City')::DATE, 2, 5)
      ON CONFLICT (visitor_id, quota_date) DO UPDATE SET generations_used = EXCLUDED.generations_used;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${confirmedReservation}'::uuid, 'pending', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 hour 5 minutes'),
             ('${visitorId}'::uuid, '${releasedReservation}'::uuid, 'pending', NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 hour 5 minutes');`
    );

    const confirmation = query(`SELECT confirm_quota('${confirmedReservation}'::uuid)`);
    const release = query(`SELECT release_quota('${releasedReservation}'::uuid)`);
    const states = query(
      `SELECT string_agg(status || ':' || (completed_at >= created_at) || ':' || (completed_at = created_at), ',' ORDER BY reservation_id) FROM quota_reservations WHERE reservation_id IN ('${confirmedReservation}'::uuid, '${releasedReservation}'::uuid)`
    );

    expect(confirmation).toContain('"confirmed"');
    expect(release).toContain('"released"');
    expect(states.trim()).toBe('completed:true:true,released:true:true');
  }, 30000);

  it('transition timestamps do not change across idempotent calls', () => {
    const confirmedVisitor = 'f998b54a-c7b8-49ff-8709-6d6d258f5574';
    const releasedVisitor = 'fa98b54a-c7b8-49ff-8709-6d6d258f5575';
    const confirmedReservation = 'f96f6f00-7008-4a10-8709-6d6d258f5574';
    const releasedReservation = 'fa6f6f00-7009-4a10-8709-6d6d258f5575';

    applyFixture(
      'idempotent-transition-timestamps',
      `DELETE FROM generation_records;
      DELETE FROM quota_reservations;

      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${confirmedVisitor}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5),
             ('${releasedVisitor}'::uuid, (NOW() AT TIME ZONE 'America/Mexico_City')::DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO UPDATE SET generations_used = EXCLUDED.generations_used;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${confirmedVisitor}'::uuid, '${confirmedReservation}'::uuid, 'pending', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '10 minutes'),
             ('${releasedVisitor}'::uuid, '${releasedReservation}'::uuid, 'pending', NOW() - INTERVAL '1 minute', NOW() + INTERVAL '10 minutes');`
    );

    query(`SELECT confirm_quota('${confirmedReservation}'::uuid)`);
    const confirmedFirst = query(
      `SELECT completed_at FROM quota_reservations WHERE reservation_id = '${confirmedReservation}'::uuid`
    );
    const secondConfirmation = query(`SELECT confirm_quota('${confirmedReservation}'::uuid)`);
    const confirmedSecond = query(
      `SELECT completed_at FROM quota_reservations WHERE reservation_id = '${confirmedReservation}'::uuid`
    );

    query(`SELECT release_quota('${releasedReservation}'::uuid)`);
    const releasedFirst = query(
      `SELECT completed_at FROM quota_reservations WHERE reservation_id = '${releasedReservation}'::uuid`
    );
    const secondRelease = query(`SELECT release_quota('${releasedReservation}'::uuid)`);
    const releasedSecond = query(
      `SELECT completed_at FROM quota_reservations WHERE reservation_id = '${releasedReservation}'::uuid`
    );

    expect(secondConfirmation).toContain('already_processed');
    expect(confirmedSecond.trim()).toBe(confirmedFirst.trim());
    expect(secondRelease).toContain('already_processed');
    expect(releasedSecond.trim()).toBe(releasedFirst.trim());
  }, 30000);

  it('confirm_quota, release_quota and mark_quota_sent are restricted to service_role', () => {
    const signatures = [
      'public.confirm_quota(uuid)',
      'public.release_quota(uuid)',
      'public.mark_quota_sent(uuid)',
    ];

    for (const signature of signatures) {
      expect(query(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`).trim()).toBe('f');
      expect(query(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`).trim()).toBe(
        'f'
      );
      expect(query(`SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`).trim()).toBe(
        't'
      );
    }

    expect(query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quota_reservations'::regclass;").trim()).toBe(
      't'
    );
  });
});


