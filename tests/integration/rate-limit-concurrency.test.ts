import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec as execCallback, execSync } from 'child_process';
import { promisify } from 'util';
import { readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(execCallback);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const CONTAINER_NAME = 'vendefacil-ratelimit-test';
const BURST_IP = '203.0.113.77';

function exec(command: string): string {
  return execSync(command, { encoding: 'utf-8', timeout: 60000 }).trim();
}

function sql(query: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${query.replace(/"/g, '\\"')}"`
  ).trim();
}

function secondsLeftInCurrentMinute(): number {
  return Number(
    sql(
      "SELECT EXTRACT(EPOCH FROM (date_trunc('minute', NOW()) + INTERVAL '1 minute' - NOW()));"
    )
  );
}

/**
 * check_rate_limit usa cubetas fijas alineadas con date_trunc (minuto, hora, dia).
 * Una rafaga que cruza el cambio de minuto se reparte en dos cubetas y puede
 * permitir mas de 10 solicitudes, por lo que la prueba se alinea al inicio de un
 * minuto (al menos 30 s de margen) para que las 20 llamadas caigan en una sola
 * cubeta. El margen es amplio frente a la duracion observada de la rafaga (~1 s).
 */
async function waitForFreshMinute(): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (secondsLeftInCurrentMinute() >= 30) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('No se pudo alinear la rafaga con el inicio de un minuto');
}

async function runBurst(ip: string, count: number): Promise<{ allowed: number; limited: number }> {
  const directory = mkdtempSync(join(tmpdir(), 'vf-ratelimit-'));
  const scriptPath = join(directory, 'burst.sh');
  const script = [
    'rm -rf /tmp/burst-out',
    'mkdir -p /tmp/burst-out',
    'i=1',
    `while [ $i -le ${count} ]; do`,
    `  psql -U testuser -d testdb -t -A -c "SELECT check_rate_limit('${ip}'::inet);" > /tmp/burst-out/$i.txt 2>&1 &`,
    '  i=$((i+1))',
    'done',
    'wait',
    `echo "allowed=$(grep -l '"allowed"' /tmp/burst-out/*.txt | wc -l)"`,
    `echo "limited=$(grep -l '"rate_limited"' /tmp/burst-out/*.txt | wc -l)"`,
    '',
  ].join('\n');

  writeFileSync(scriptPath, script, 'utf8');
  exec(`docker cp "${scriptPath}" ${CONTAINER_NAME}:/tmp/burst.sh`);
  const { stdout } = await execAsync(`docker exec ${CONTAINER_NAME} sh /tmp/burst.sh`);
  rmSync(directory, { recursive: true, force: true });

  return {
    allowed: Number(/allowed=(\d+)/.exec(stdout)?.[1]),
    limited: Number(/limited=(\d+)/.exec(stdout)?.[1]),
  };
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

  it('20 solicitudes simultaneas respetan el limite de 10 por minuto', async () => {
    await waitForFreshMinute();

    const { allowed, limited } = await runBurst(BURST_IP, 20);

    expect(allowed).toBe(10);
    expect(limited).toBe(10);

    // Toda solicitud permitida incrementa las cubetas de minuto, hora y dia con el
    // mismo valor. Tres filas con 10 cada una prueban que la rafaga completo una sola
    // cubeta de minuto sin exceder el limite.
    const buckets = sql(
      `SELECT COUNT(*) FROM ip_rate_limits WHERE ip_address = '${BURST_IP}'::inet AND request_count > 0;`
    );
    const maxBucketCount = sql(
      `SELECT COALESCE(MAX(request_count), 0) FROM ip_rate_limits WHERE ip_address = '${BURST_IP}'::inet;`
    );
    const totalCount = sql(
      `SELECT COALESCE(SUM(request_count), 0) FROM ip_rate_limits WHERE ip_address = '${BURST_IP}'::inet;`
    );

    expect(Number(buckets)).toBe(3);
    expect(Number(maxBucketCount)).toBe(10);
    expect(Number(totalCount)).toBe(30);
  }, 120000);

  it('superar 10 en la misma cubeta responde rate_limited sin consumir cuota', () => {
    const ip = '203.0.113.80';

    // Sembrado y llamada en una sola transicion: NOW() es el inicio de la transaccion
    // y no cambia entre sentencias, por lo que comparten cubeta de minuto.
    const lines = sql(
      `INSERT INTO ip_rate_limits (ip_address, window_start, request_count) VALUES ('${ip}'::inet, date_trunc('minute', NOW()), 10); SELECT check_rate_limit('${ip}'::inet); SELECT request_count FROM ip_rate_limits WHERE ip_address = '${ip}'::inet AND window_start = date_trunc('minute', NOW());`
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const payload = lines.find((line) => line.startsWith('{'));
    const response = JSON.parse(payload ?? '{}') as {
      status: string;
      window: string;
      limit: number;
      retry_after_seconds: number;
    };
    const stored = Number(lines[lines.length - 1]);

    expect(response.status).toBe('rate_limited');
    expect(response.window).toBe('minute');
    expect(response.limit).toBe(10);
    expect(response.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(stored).toBe(10);
  });

  it('las cubetas son de calendario: el minuto anterior no descuenta el actual', () => {
    const ip = '203.0.113.79';

    const response = sql(
      `INSERT INTO ip_rate_limits (ip_address, window_start, request_count) VALUES ('${ip}'::inet, date_trunc('minute', NOW()) - INTERVAL '1 minute', 10); SELECT check_rate_limit('${ip}'::inet);`
    );

    expect(response).toContain('"allowed"');
  });

  it('IPs distintas tienen contadores independientes', async () => {
    const firstIp = '198.51.100.10';
    const secondIp = '198.51.100.11';

    const first = sql(`SELECT check_rate_limit('${firstIp}'::inet);`);
    const second = sql(`SELECT check_rate_limit('${secondIp}'::inet);`);

    expect(first).toContain('"allowed"');
    expect(second).toContain('"allowed"');
  });
});