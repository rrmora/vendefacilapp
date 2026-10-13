import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-quota-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

function query(sql: string): string {
  return exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "${sql.replace(/"/g, '\\"')}"`);
}

function reservationId(prefix: string, index: number): string {
  return `${prefix}-e29b-41d4-a716-44665544${index.toString().padStart(4, '0')}`;
}

function getQuotaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

async function reserveBurst(visitorId: string, quotaDate: string, prefix: string, count: number): Promise<string[]> {
  const calls = Array.from({ length: count }, (_, i) => {
    const rid = reservationId(prefix, i);
    const sql = `SELECT reserve_quota('${visitorId}'::uuid, '${quotaDate}'::date, '${rid}'::uuid);`;
    return execAsync(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "${sql}"`);
  });

  const results = await Promise.all(calls);
  return results.map((r) => r.stdout.trim());
}

function countStatus(results: string[], status: string): number {
  return results.filter((r) => r.includes(`"${status}"`)).length;
}

async function confirmPending(visitorId: string): Promise<void> {
  const pendingIds = query(
    `SELECT reservation_id FROM quota_reservations WHERE visitor_id = '${visitorId}' AND status = 'pending';`
  );

  const ids = pendingIds.split('\n').map((s) => s.trim()).filter(Boolean);

  for (const id of ids) {
    query(`SELECT confirm_quota('${id}'::uuid);`);
  }
}

describe('quota concurrency integration', () => {
  beforeAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }

    exec(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_USER=testuser -e POSTGRES_PASSWORD=testpass123 -e POSTGRES_DB=testdb -d postgres:17-alpine`
    );

    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const result = exec(`docker exec ${CONTAINER_NAME} pg_isready -U testuser -d testdb`);
        if (result.includes('accepting connections')) {
          ready = true;
          break;
        }
      } catch {
      }
      execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore' });
    }

    if (!ready) {
      throw new Error('PostgreSQL no se pudo iniciar');
    }

    exec(`docker exec ${CONTAINER_NAME} mkdir -p /tmp/migrations`);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const localPath = join(MIGRATIONS_DIR, file);
      const remotePath = `/tmp/migrations/${file}`;
      exec(`docker cp "${localPath}" ${CONTAINER_NAME}:${remotePath}`);
    }

    for (const file of files) {
      const remotePath = `/tmp/migrations/${file}`;
      exec(`docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -f ${remotePath}`);
    }
  }, 180000);

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('20 reservas simultaneas respetan el limite de 3 pendientes', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440000';
    const quotaDate = '2026-10-12';

    const results = await reserveBurst(visitorId, quotaDate, '660e8400', 20);

    const reserved = countStatus(results, 'reserved');
    const rateLimited = countStatus(results, 'rate_limited');
    const quotaExceeded = countStatus(results, 'quota_exceeded');

    expect(reserved).toBeLessThanOrEqual(5);
    expect(reserved).toBe(3);
    expect(rateLimited).toBe(17);
    expect(quotaExceeded).toBe(0);
  }, 90000);

  it('ciclo completo confirma y alcanza exactamente 5 generaciones', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440000';
    const quotaDate = '2026-10-12';

    await confirmPending(visitorId);

    const results = await reserveBurst(visitorId, quotaDate, '670e8400', 20);

    const reserved = countStatus(results, 'reserved');
    const quotaExceeded = countStatus(results, 'quota_exceeded');

    expect(reserved).toBe(2);
    expect(quotaExceeded).toBe(18);

    const used = parseInt(
      query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}' AND quota_date = '${quotaDate}';`),
      10
    );

    expect(used).toBe(5);
  }, 90000);

  it('generations_used nunca excede max_generations', async () => {
    const used = parseInt(
      query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '550e8400-e29b-41d4-a716-446655440000' AND quota_date = '2026-10-12';`),
      10
    );

    expect(used).toBeLessThanOrEqual(5);
    expect(used).toBe(5);
  });

  it('maximo 3 reservas pendientes simultaneas en visitante nuevo', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440001';
    const quotaDate = '2026-10-12';

    const results = await reserveBurst(visitorId, quotaDate, '680e8400', 5);

    const reserved = countStatus(results, 'reserved');
    const rateLimited = countStatus(results, 'rate_limited');

    expect(reserved).toBe(3);
    expect(rateLimited).toBe(2);
  }, 60000);

  it('liberar reserva decrementa generations_used', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440002';
    const quotaDate = getQuotaDate();
    const reservationId = '770e8400-e29b-41d4-a716-446655440001';

    query(`SELECT reserve_quota('${visitorId}'::uuid, '${quotaDate}'::date, '${reservationId}'::uuid);`);
    query(`SELECT release_quota('${reservationId}'::uuid);`);

    const used = parseInt(
      query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}' AND quota_date = '${quotaDate}';`),
      10
    );

    expect(used).toBe(0);
  });

  it('confirmacion duplicada es idempotente', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440003';
    const quotaDate = '2026-10-12';
    const reservationId = '880e8400-e29b-41d4-a716-446655440002';

    query(`SELECT reserve_quota('${visitorId}'::uuid, '${quotaDate}'::date, '${reservationId}'::uuid);`);
    query(`SELECT confirm_quota('${reservationId}'::uuid);`);
    const secondConfirm = query(`SELECT confirm_quota('${reservationId}'::uuid);`);

    expect(secondConfirm).toContain('already_processed');
  });

  it('liberar reserva creada antes de medianoche decrementa el dia original', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440004';
    const originalDate = '2026-01-14';
    const reservationId = '770e8400-e29b-41d4-a716-446655440004';
    const createdAt = '2026-01-15 05:00:00+00';

    query(
      `INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations) VALUES ('${visitorId}', '${originalDate}', 1, 5);`
    );
    query(
      `INSERT INTO quota_reservations (visitor_id, reservation_id, status, expires_at, created_at) VALUES ('${visitorId}', '${reservationId}', 'pending', NOW() + INTERVAL '5 minutes', '${createdAt}');`
    );

    const result = query(`SELECT release_quota('${reservationId}'::uuid);`);

    expect(result).toContain('"released"');

    const used = parseInt(
      query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}' AND quota_date = '${originalDate}';`),
      10
    );

    expect(used).toBe(0);
  });

  it('expirar reserva libera la cuota del dia original aunque expire al dia siguiente', async () => {
    const visitorId = '550e8400-e29b-41d4-a716-446655440005';
    const originalDate = '2026-01-14';
    const reservationId = '770e8400-e29b-41d4-a716-446655440005';
    const createdAt = '2026-01-15 05:00:00+00';

    query(
      `INSERT INTO visitor_daily_quota (visitor_id, quota_date, generations_used, max_generations) VALUES ('${visitorId}', '${originalDate}', 1, 5);`
    );
    query(
      `INSERT INTO quota_reservations (visitor_id, reservation_id, status, expires_at, created_at) VALUES ('${visitorId}', '${reservationId}', 'pending', '2026-01-15 05:30:00+00', '${createdAt}');`
    );

    const expired = parseInt(query(`SELECT expire_pending_reservations();`), 10);

    expect(expired).toBeGreaterThanOrEqual(1);

    const used = parseInt(
      query(`SELECT generations_used FROM visitor_daily_quota WHERE visitor_id = '${visitorId}' AND quota_date = '${originalDate}';`),
      10
    );

    expect(used).toBe(0);
  });
});
