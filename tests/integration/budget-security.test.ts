import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-budget-security-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

function sqlAs(role: string, statement: string): string {
  return `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SET ROLE ${role}; ${statement};"`;
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

describe('budget security integration', () => {
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

    exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"`
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
  }, 180000);

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('anon no puede leer budget_reservations', () => {
    let failed = false;
    try {
      exec(sqlAs('anon', "SELECT * FROM public.budget_reservations"));
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).toContain('permission denied');
    }
    expect(failed).toBe(true);
  });

  it('authenticated no puede ejecutar reserve_budget', () => {
    let failed = false;
    try {
      exec(
        sqlAs(
          'authenticated',
          "SELECT public.reserve_budget('00000000-0000-4000-8000-000000000001'::uuid, '2026-10', 0.1, 5.00)"
        )
      );
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).toContain('permission denied');
    }
    expect(failed).toBe(true);
  });

  it('el servicio puede crear y limpiar Budget reservation con RLS activa', () => {
    const result = exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT reserve_budget('00000000-0000-4000-8000-000000000002'::uuid, '2026-10', 0.1, 5.00);"`
    );
    expect(result).toContain('"reserved"');
  });
});