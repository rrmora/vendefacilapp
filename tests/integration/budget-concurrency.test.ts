import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-budget-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

function uuid(index: number): string {
  return `770e8400-e29b-41d4-a716-44665544${index.toString().padStart(4, '0')}`;
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

describe('budget concurrency integration', () => {
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
    for (let i = 0; i < 90 && consecutive < 3; i++) {
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
  }, 180000);

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('reservas simultaneas respetan el presupuesto del 95%', async () => {
    const month = '2026-10';
    const requests = Array.from({ length: 10 }, (_, index) =>
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reserve_budget('${uuid(index)}'::uuid, '${month}', 0.5, 5.00);"`
      )
    );

    const results = await Promise.all(requests);
    const values = results.map((result) => result.stdout.trim());

    const reserved = values.filter((value) => value.includes('"reserved"')).length;
    const exceeded = values.filter((value) => value.includes('"budget_exceeded"')).length;

    expect(reserved).toBe(9);
    expect(exceeded).toBe(1);
  });

  it('confirmacion no bloquea idempotencia', async () => {
    const month = '2026-11';
    const reservationId = uuid(99);
    exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reserve_budget('${reservationId}'::uuid, '${month}', 1.00, 5.00);"`
    );

    const first = exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT confirm_budget('${reservationId}'::uuid, 0.10, false);"`
    );
    const second = exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT confirm_budget('${reservationId}'::uuid, 0.10, false);"`
    );

    expect(first).toContain('"confirmed"');
    expect(second).toContain('"already_processed"');
  });
});