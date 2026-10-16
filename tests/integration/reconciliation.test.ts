import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-reconciliation-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 50000 }).trim();
}

function query(sql: string): string {
  return exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${sql.replace(/"/g, '\\"')}"`);
}

function runSqlFile(file: string): string {
  return exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f /tmp/${file}`);
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
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute');

      INSERT INTO generation_records (visitor_id, reservation_id, success)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, true);
    `);

    const expired = query("SELECT expire_pending_reservations()");
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

    expect(Number(expired.trim())).toBe(0);
    expect(status.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  });

  it('pending quota reservation without a success record is expired and released', () => {
    const visitorId = '9298b54a-c7b8-49ff-8709-6d6d258f5552';
    const reservationId = '7f6f6f00-0202-4a10-8709-6d6d258f5552';

    applyFixture('failed-quota-reconciliation', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute');
    `);

    const expired = query("SELECT expire_pending_reservations()");
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

    expect(Number(expired.trim())).toBe(1);
    expect(status.trim()).toBe('expired');
    expect(Number(used.trim())).toBe(0);
  });

  it('mark_quota_sent moves a pending reservation to sent_uncertain once', () => {
    const visitorId = '9398b54a-c7b8-49ff-8709-6d6d258f5553';
    const reservationId = '8f6f6f00-0303-4a10-8709-6d6d258f5553';

    applyFixture('mark-quota-sent', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '3 minutes');
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

    applyFixture('uncertain-quota-reconciliation', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute');
    `);

    const expired = query('SELECT expire_pending_reservations()');
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

    expect(Number(expired.trim())).toBe(0);
    expect(status.trim()).toBe('sent_uncertain');
    expect(Number(used.trim())).toBe(1);
  });

  it('expire_pending_reservations completes an uncertain reservation with a success record', () => {
    const visitorId = '9598b54a-c7b8-49ff-8709-6d6d258f5555';
    const reservationId = 'af6f6f00-0505-4a10-8709-6d6d258f5555';

    applyFixture('uncertain-quota-success', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute');

      INSERT INTO generation_records (visitor_id, reservation_id, success)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, true);
    `);

    const expired = query('SELECT expire_pending_reservations()');
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

    expect(Number(expired.trim())).toBe(0);
    expect(status.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  });

  it('confirm_quota confirms an uncertain reservation only once', () => {
    const visitorId = '9698b54a-c7b8-49ff-8709-6d6d258f5556';
    const reservationId = 'bf6f6f00-0606-4a10-8709-6d6d258f5556';

    applyFixture('uncertain-quota-confirm', `
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '3 minutes');
    `);

    const first = query(`SELECT confirm_quota('${reservationId}'::uuid)`);
    const second = query(`SELECT confirm_quota('${reservationId}'::uuid)`);
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

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
      VALUES ('${visitorId}'::uuid, CURRENT_DATE, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING;

      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'sent_uncertain', NOW() - INTERVAL '2 minutes', NOW() + INTERVAL '3 minutes');
    `);

    const released = query(`SELECT release_quota('${reservationId}'::uuid)`);
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}'::uuid AND quota_date = CURRENT_DATE`);

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
      ON CONFLICT (month) DO NOTHING;

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
    expect(tracking.trim()).toContain('0');
  });
});


