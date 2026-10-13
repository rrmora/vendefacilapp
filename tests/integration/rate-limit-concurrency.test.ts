import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-ratelimit-test';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 30000 }).trim();
}

describe('rate limit concurrency integration', () => {
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

  it('20 solicitudes simultaneas respetan el limite de 10 por minuto', async () => {
    const ip = '203.0.113.77';

    const calls = Array.from({ length: 20 }, () =>
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT check_rate_limit('${ip}'::inet);"`
      )
    );

    const results = await Promise.all(calls);
    const values = results.map((result) => result.stdout.trim());

    const allowed = values.filter((value) => value.includes('"allowed"')).length;
    const limited = values.filter((value) => value.includes('"rate_limited"')).length;

    expect(allowed).toBe(10);
    expect(limited).toBe(10);
  });

  it('IPs distintas tienen contadores independientes', async () => {
    const firstIp = '198.51.100.10';
    const secondIp = '198.51.100.11';

    const first = exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT check_rate_limit('${firstIp}'::inet);"`
    );
    const second = exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT check_rate_limit('${secondIp}'::inet);"`
    );

    expect(first).toContain('"allowed"');
    expect(second).toContain('"allowed"');
  });
});