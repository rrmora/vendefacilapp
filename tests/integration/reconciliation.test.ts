import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-reconciliation-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

function query(sql: string): string {
  try {
    return exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${sql.replace(/"/g, '\\"')}"`).trim();
  } catch (error) {
    console.error((error as Error).message);
    throw error;
  }
}

describe.skip('reconciliation integration', () => {
  beforeAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {}

    exec(`docker run --name ${CONTAINER_NAME} -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpass123 -e POSTGRES_DB=testdb -d postgres:17-alpine`);

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const result = exec(`docker exec ${CONTAINER_NAME} pg_isready -U testuser -d testdb`);
        if (result.includes('accepting connections')) {
          ready = true;
          break;
        }
      } catch {}
      execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore' });
    }

    if (!ready) {
      throw new Error('PostgreSQL no se pudo iniciar');
    }

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      exec(`docker cp "${join(MIGRATIONS_DIR, file)}" ${CONTAINER_NAME}:/tmp/${file}`);
      exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f /tmp/${file}`);
    }
  }, 180000);

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {}
  });

  it('successful pending reservation is not released by expiration', async () => {
    const visitorId = '9198b54a-c7b8-49ff-8709-6d6d258f5551';
    const reservationId = '6f6f6f00-0101-4a10-8709-6d6d258f5551';
    const quotaDate = '2026-10-20';

    query(`
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, '${quotaDate}'::date, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING
    `);

    query(`
      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute')
    `);

    query(`
      INSERT INTO generation_records (visitor_id, reservation_id, success)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, true)
    `);

    const expired = query('SELECT expire_pending_reservations()');
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id='${visitorId}'::uuid AND quota_date='${quotaDate}'::date`);

    expect(expired.trim()).toBe('0');
    expect(status.trim()).toBe('completed');
    expect(Number(used.trim())).toBe(1);
  });

  it('pending reservation without success record is expired and released', async () => {
    const visitorId = '9298b54a-c7b8-49ff-8709-6d6d258f5552';
    const reservationId = '7f6f6f00-0202-4a10-8709-6d6d258f5552';
    const quotaDate = '2026-10-21';

    query(`
      INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations)
      VALUES ('${visitorId}'::uuid, '${quotaDate}'::date, 1, 5)
      ON CONFLICT (visitor_id, quota_date) DO NOTHING
    `);

    query(`
      INSERT INTO quota_reservations (visitor_id, reservation_id, status, created_at, expires_at)
      VALUES ('${visitorId}'::uuid, '${reservationId}'::uuid, 'pending', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute')
    `);

    const expired = query('SELECT expire_pending_reservations()');
    const status = query(`SELECT status FROM quota_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const used = query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id='${visitorId}'::uuid AND quota_date='${quotaDate}'::date`);

    expect(Number(expired.trim())).toBe(1);
    expect(status.trim()).toBe('expired');
    expect(Number(used.trim())).toBe(0);
  });

  it('reconcile_pending_budget_reservations confirms old reservations', async () => {
    const reservationId = 'ffffffff-1111-4aaa-8bbb-ccccdddd0000';
    const month = new Date().toISOString().slice(0, 7);

    query(`
      INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 1.2)
      ON CONFLICT (month) DO NOTHING
    `);

    query(`
      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${reservationId}'::uuid, '${month}', 'reserved', 1.2, 0, true, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')
    `);

    const count = query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    const status = query(`SELECT status FROM budget_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const tracking = query(`SELECT reserved_usd, spent_usd FROM budget_tracking WHERE month = '${month}'`);

    expect(Number(count.trim())).toBe(1);
    expect(status.trim()).toBe('confirmed');
    expect(tracking.trim()).toContain('0');
  });

  it('reconcile_pending_budget_reservations is idempotent', async () => {
    const reservationId = 'ffffffff-1111-4aaa-8bbb-ccccdddd1111';
    const month = new Date().toISOString().slice(0, 7);

    query(`
      INSERT INTO budget_tracking (month, spent_usd, reserved_usd)
      VALUES ('${month}', 0, 1.2)
      ON CONFLICT (month) DO NOTHING
    `);

    query(`
      INSERT INTO budget_reservations (reservation_id, budget_month, status, reserved_cost_usd, actual_cost_usd, cost_estimated, created_at, updated_at)
      VALUES ('${reservationId}'::uuid, '${month}', 'reserved', 1.2, 0, true, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')
    `);

    query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);
    query(`SELECT reconcile_pending_budget_reservations('15 minutes'::interval)`);

    const status = query(`SELECT status FROM budget_reservations WHERE reservation_id = '${reservationId}'::uuid`);
    const tracking = query(`SELECT reserved_usd, spent_usd FROM budget_tracking WHERE month = '${month}'`);

    expect(status.trim()).toBe('confirmed');
    expect(tracking.trim()).toContain('0');
  });
});
