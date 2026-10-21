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

function sql(statement: string): string {
  return exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "${statement.replace(/"/g, '\\"')}"`
  ).trim();
}

/**
 * Varias sentencias en una sola transicion: NOW() es el inicio de la transaccion
 * y no cambia entre ellas, por lo que la siembra y la llamada comparten el
 * mismo instante de referencia y las fronteras son exactas. El SQL viaja como
 * fixture porque las siembras grandes superan el limite de linea de comandos.
 */
function rows(statements: string, name = 'fixture'): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'vf-ratelimit-'));
  const file = `${name}.sql`;

  writeFileSync(join(directory, file), statements, 'utf8');
  exec(`docker cp "${join(directory, file)}" ${CONTAINER_NAME}:/tmp/${file}`);
  const output = exec(
    `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -q -t -A -f /tmp/${file}`
  );
  rmSync(directory, { recursive: true, force: true });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function seedEvents(ip: string, count: number, oldestAge: number, stepSeconds: number): string {
  const values = Array.from(
    { length: count },
    (_, i) =>
      `('${ip}'::inet, NOW() - INTERVAL '${(oldestAge - i * stepSeconds).toFixed(3)} seconds')`
  ).join(', ');

  return `INSERT INTO ip_rate_limit_events (ip_address, accepted_at) VALUES ${values};`;
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

function parsePayload(lines: string[]): Record<string, unknown> {
  const payload = lines.find((line) => line.startsWith('{'));
  return JSON.parse(payload ?? '{}') as Record<string, unknown>;
}

describe('rate limit sliding window integration', () => {
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
      // El entrypoint de postgres levanta un servidor efimero para el setup y luego
      // lo reinicia: una consulta real exige 3 respuestas seguidas para confirmar
      // que el servidor quedo estable.
      consecutive = probeDatabase() === '1' ? consecutive + 1 : 0;
      if (consecutive < 3) {
        execSync('ping -n 2 127.0.0.1 > nul 2>&1', { stdio: 'ignore' });
      }
    }

    if (consecutive < 3) {
      throw new Error('PostgreSQL no se pudo iniciar');
    }

    // Roles de Supabase para verificar permisos en tiempo de ejecucion.
    exec(
      `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"`
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

  afterAll(() => {
    try {
      exec(`docker rm -f ${CONTAINER_NAME} 2>nul`);
    } catch {
    }
  });

  it('20 solicitudes simultaneas respetan el limite de 10 en cualquier ventana de 60 s', async () => {
    const { allowed, limited } = await runBurst(BURST_IP, 20);

    expect(allowed).toBe(10);
    expect(limited).toBe(10);

    // Maximo de aceptadas contenidas en cualquier ventana deslizante de 60 s.
    const [maxInSlidingWindow, acceptedTotal] = rows(`
      SELECT COALESCE(MAX(c), 0) FROM (
        SELECT count(*) OVER (
          ORDER BY accepted_at RANGE BETWEEN INTERVAL '60 seconds' PRECEDING AND CURRENT ROW
        ) AS c
        FROM ip_rate_limit_events
        WHERE ip_address = '${BURST_IP}'::inet
      ) t;

      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${BURST_IP}'::inet;
    `);

    expect(Number(acceptedTotal)).toBe(10);
    expect(Number(maxInSlidingWindow)).toBe(10);
  }, 120000);

  it('el limite sigue vigente al cruzar el minuto de calendario', () => {
    const ip = '203.0.113.90';

    // Cinco eventos justo antes del minuto de calendario y cinco dentro del
    // minuto actual. La implementacion de cubetas fijas los trataria como dos
    // ventanas independientes y permitiria hasta 20 solicitudes. El desplazamiento
    // del primer grupo se calcula desde el reloj de la base para que siempre caiga
    // dentro de los 60 s, sin importar en que segundo se ejecute la prueba.
    const lines = rows(`
      WITH pos AS (
        SELECT EXTRACT(EPOCH FROM (NOW() - date_trunc('minute', NOW())))::double precision AS s
      )
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      SELECT '${ip}'::inet,
        CASE WHEN i <= 5
          THEN NOW() - make_interval(secs => GREATEST((SELECT s FROM pos) - 0.5, 0.5))
          ELSE NOW() - make_interval(secs => 0.1)
        END
      FROM generate_series(1, 10) AS i;

      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${ip}'::inet
          AND accepted_at > clock_timestamp() - INTERVAL '60 seconds';

      SELECT check_rate_limit('${ip}'::inet);
    `, 'minute-crossing');

    expect(Number(lines[0])).toBe(10);
    expect(parsePayload(lines).status).toBe('rate_limited');
    expect(parsePayload(lines).window).toBe('minute');
    expect(parsePayload(lines).current).toBe(10);
  });

  it('rechaza dentro de la ventana y acepta en el instante limite de 60 s', () => {
    const insideIp = '203.0.113.91';
    const boundaryIp = '203.0.113.92';

    const inside = parsePayload(
      rows(`
        ${seedEvents(insideIp, 10, 59, 0.1)}
        SELECT check_rate_limit('${insideIp}'::inet);
      `)
    );
    const boundary = parsePayload(
      rows(`
        ${seedEvents(boundaryIp, 10, 60, 0.1)}
        SELECT check_rate_limit('${boundaryIp}'::inet);
      `)
    );

    expect(inside.status).toBe('rate_limited');
    expect(Number(inside.retry_after_seconds)).toBeGreaterThanOrEqual(1);
    expect(Number(inside.retry_after_seconds)).toBeLessThanOrEqual(60);
    expect(boundary.status).toBe('allowed');
  });

  it('aplica el limite movil de una hora cuando la ventana de 60 s esta libre', () => {
    const ip = '203.0.113.93';

    // 100 aceptadas con antiguedad entre 728 s y 3500 s: la ventana de un minuto
    // queda libre y la de una hora esta en el limite.
    const response = parsePayload(
      rows(`
        ${seedEvents(ip, 100, 3500, 28)}
        SELECT check_rate_limit('${ip}'::inet);
      `, 'hour-limit')
    );

    expect(response.status).toBe('rate_limited');
    expect(response.window).toBe('hour');
    expect(response.limit).toBe(100);
    expect(response.current).toBe(100);
    expect(Number(response.retry_after_seconds)).toBeGreaterThanOrEqual(1);
  });

  it('aplica el limite movil de 24 horas cuando las ventanas cortas estan libres', () => {
    const ip = '203.0.113.94';

    const response = parsePayload(
      rows(`
        ${seedEvents(ip, 500, 86000, 170)}
        SELECT check_rate_limit('${ip}'::inet);
      `, 'day-limit')
    );

    expect(response.status).toBe('rate_limited');
    expect(response.window).toBe('day');
    expect(response.limit).toBe(500);
    expect(response.current).toBe(500);
  });

  it('las fronteras de hora y dia no acumulan ventanas independientes', () => {
    const ip = '203.0.113.95';

    // 100 eventos con 3599 s de antiguedad y 100 con 3700 s: solo los primeros
    // entran en la ventana movil de una hora.
    const [minuteCount, hourCount, dayCount] = rows(`
      ${seedEvents(ip, 100, 3599, 0.1)}
      ${seedEvents(ip, 100, 3700, 0.1)}
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${ip}'::inet AND accepted_at > clock_timestamp() - INTERVAL '60 seconds';
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${ip}'::inet AND accepted_at > clock_timestamp() - INTERVAL '3600 seconds';
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${ip}'::inet AND accepted_at > clock_timestamp() - INTERVAL '86400 seconds';
    `);

    expect(Number(minuteCount)).toBe(0);
    expect(Number(hourCount)).toBe(100);
    expect(Number(dayCount)).toBe(200);
  });

  it('reporta counts exactos de cada ventana movil', () => {
    const ip = '203.0.113.96';

    const response = parsePayload(
      rows(`
        ${seedEvents(ip, 3, 30, 1)}
        ${seedEvents(ip, 4, 600, 1)}
        ${seedEvents(ip, 2, 7200, 1)}
        SELECT check_rate_limit('${ip}'::inet);
      `)
    ) as {
      status: string;
      counts: { minute: number; hour: number; day: number };
      limits: { minute: number; hour: number; day: number };
    };

    expect(response.status).toBe('allowed');
    expect(response.counts.minute).toBe(4);
    expect(response.counts.hour).toBe(8);
    expect(response.counts.day).toBe(10);
    expect(response.limits).toEqual({ minute: 10, hour: 100, day: 500 });
  });

  it('expulsa los eventos con mas de 24 horas y no los cuenta', () => {
    const ip = '203.0.113.97';

    const [beforeCount, accepted] = rows(`
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      VALUES ('${ip}'::inet, clock_timestamp() - INTERVAL '25 hours');
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      SELECT check_rate_limit('${ip}'::inet);
    `);

    expect(Number(beforeCount)).toBe(1);
    expect(accepted).toContain('"allowed"');

    const [expiredLeft, remaining] = rows(`
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${ip}'::inet AND accepted_at <= clock_timestamp() - INTERVAL '24 hours';
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
    `);

    expect(Number(expiredLeft)).toBe(0);
    expect(Number(remaining)).toBe(1);
  });

  it('IPs distintas tienen contadores independientes', () => {
    const [first, second] = rows(`
      SELECT check_rate_limit('198.51.100.10'::inet);
      SELECT check_rate_limit('198.51.100.11'::inet);
    `);

    expect(first).toContain('"allowed"');
    expect(second).toContain('"allowed"');
  });

  it('anon y authenticated no pueden ejecutar check_rate_limit', () => {
    expect(sql(`SELECT has_function_privilege('anon', 'public.check_rate_limit(inet)', 'EXECUTE');`).trim()).toBe('f');
    expect(
      sql(`SELECT has_function_privilege('authenticated', 'public.check_rate_limit(inet)', 'EXECUTE');`).trim()
    ).toBe('f');
  });

  it('service_role puede ejecutar check_rate_limit', () => {
    expect(sql(`SELECT has_function_privilege('service_role', 'public.check_rate_limit(inet)', 'EXECUTE');`).trim()).toBe(
      't'
    );
  });

  it('los clientes anonimos no tienen privilegios sobre los eventos', () => {
    expect(
      sql(`SELECT has_table_privilege('anon', 'public.ip_rate_limit_events', 'SELECT, INSERT, DELETE');`).trim()
    ).toBe('f');
    expect(
      sql(`SELECT has_table_privilege('authenticated', 'public.ip_rate_limit_events', 'SELECT, INSERT, DELETE');`).trim()
    ).toBe('f');
    expect(
      sql(`SELECT has_table_privilege('service_role', 'public.ip_rate_limit_events', 'SELECT, INSERT, DELETE');`).trim()
    ).toBe('t');
  });

  it('RLS activo, search_path seguro y tabla legada conservada', () => {
    expect(
      sql("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ip_rate_limit_events'::regclass;").trim()
    ).toBe('t');
    expect(
      sql("SELECT proconfig FROM pg_proc WHERE oid = 'public.check_rate_limit(inet)'::regprocedure;").trim()
    ).toContain('search_path=public, pg_temp');
    expect(sql("SELECT to_regclass('public.ip_rate_limits') IS NOT NULL;").trim()).toBe('t');
  });

  it('anon no puede leer los eventos de rate limit', () => {
    let failed = false;
    try {
      exec(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SET ROLE anon; SELECT * FROM public.ip_rate_limit_events;"`
      );
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).toContain('permission denied');
    }
    expect(failed).toBe(true);
  });

  it('cleanup_rate_limit_events elimina eventos con mas de 25 horas y conserva 24 y 23 horas', () => {
    const oldIp = '198.51.100.201';
    const dayIp = '198.51.100.202';
    const recentIp = '198.51.100.203';

    rows(`
      DELETE FROM ip_rate_limit_events
        WHERE ip_address IN ('${oldIp}'::inet, '${dayIp}'::inet, '${recentIp}'::inet);
      SELECT public.cleanup_rate_limit_events();
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      VALUES ('${oldIp}'::inet, clock_timestamp() - INTERVAL '26 hours'),
             ('${dayIp}'::inet, clock_timestamp() - INTERVAL '24 hours'),
             ('${recentIp}'::inet, clock_timestamp() - INTERVAL '23 hours');
    `, 'cleanup-retention-seed');

    const [deleted, oldLeft, dayLeft, recentLeft] = rows(`
      SELECT public.cleanup_rate_limit_events();
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${oldIp}'::inet;
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${dayIp}'::inet;
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${recentIp}'::inet;
    `, 'cleanup-retention-check');

    expect(Number(deleted)).toBe(1);
    expect(Number(oldLeft)).toBe(0);
    expect(Number(dayLeft)).toBe(1);
    expect(Number(recentLeft)).toBe(1);
  });

  it('cleanup_rate_limit_events es idempotente en ejecuciones repetidas', () => {
    const ip = '198.51.100.204';

    rows(`
      DELETE FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      SELECT public.cleanup_rate_limit_events();
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      VALUES ('${ip}'::inet, clock_timestamp() - INTERVAL '26 hours');
    `, 'cleanup-idempotent-seed');

    const [first, second, left] = rows(`
      SELECT public.cleanup_rate_limit_events();
      SELECT public.cleanup_rate_limit_events();
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
    `, 'cleanup-idempotent-check');

    expect(Number(first)).toBe(1);
    expect(Number(second)).toBe(0);
    expect(Number(left)).toBe(0);
  });

  it('cleanup_rate_limit_events procesa lotes grandes sin dejar eventos elegibles', () => {
    const ip = '198.51.100.210';
    const total = 2500;
    const batchSize = 100;

    rows(`
      DELETE FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      SELECT public.cleanup_rate_limit_events();
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      SELECT '${ip}'::inet, clock_timestamp() - INTERVAL '26 hours'
      FROM generate_series(1, ${total});
    `, 'cleanup-large-seed');

    const [deleted, remaining, eligible] = rows(`
      SELECT public.cleanup_rate_limit_events(INTERVAL '25 hours', ${batchSize});
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      SELECT count(*) FROM ip_rate_limit_events WHERE accepted_at < clock_timestamp() - INTERVAL '25 hours';
    `, 'cleanup-large-check');

    expect(Number(deleted)).toBe(total);
    expect(Number(remaining)).toBe(0);
    expect(Number(eligible)).toBe(0);
  }, 60000);

  it('cleanup_rate_limit_events y check_rate_limit son seguros en concurrencia', async () => {
    const cleanupIp = '198.51.100.221';
    const checkIp = '198.51.100.222';

    rows(`
      DELETE FROM ip_rate_limit_events
        WHERE ip_address IN ('${cleanupIp}'::inet, '${checkIp}'::inet);
      SELECT public.cleanup_rate_limit_events();
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      VALUES ('${cleanupIp}'::inet, clock_timestamp() - INTERVAL '26 hours'),
             ('${checkIp}'::inet, clock_timestamp() - INTERVAL '26 hours');
      INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
      SELECT '${checkIp}'::inet, clock_timestamp() - make_interval(secs => i)
      FROM generate_series(1, 9) AS i;
    `, 'cleanup-concurrency-seed');

    const [, check] = await Promise.all([
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT public.cleanup_rate_limit_events();"`
      ),
      execAsync(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -t -A -c "SELECT public.check_rate_limit('${checkIp}'::inet);"`
      ),
    ]);

    const response = parsePayload(check.stdout.split('\n')) as {
      status: string;
      counts: { minute: number };
    };
    const [oldCleanupLeft, oldCheckLeft, recentCount] = rows(`
      SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${cleanupIp}'::inet;
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${checkIp}'::inet
          AND accepted_at <= clock_timestamp() - INTERVAL '24 hours';
      SELECT count(*) FROM ip_rate_limit_events
        WHERE ip_address = '${checkIp}'::inet
          AND accepted_at > clock_timestamp() - INTERVAL '60 seconds';
    `, 'cleanup-concurrency-check');

    expect(response.status).toBe('allowed');
    expect(response.counts.minute).toBe(10);
    expect(Number(oldCleanupLeft)).toBe(0);
    expect(Number(oldCheckLeft)).toBe(0);
    expect(Number(recentCount)).toBe(10);
  }, 60000);

  it('dos limpiezas concurrentes: la segunda retorna 0 mientras la primera mantiene el advisory lock', async () => {
    const ip = '198.51.100.230';
    const lockHolderApp = 'vf-cleanup-lock-holder';
    const firstCleanupApp = 'vf-cleanup-first';
    const secondCleanupApp = 'vf-cleanup-second';
    let holder: Promise<{ stdout: string; stderr: string }> | undefined;
    let first: Promise<{ stdout: string; stderr: string }> | undefined;

    const terminate = (applicationName: string) => {
      try {
        sql(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '${applicationName}' AND pid <> pg_backend_pid();`
        );
      } catch {
      }
    };

    const waitFor = async (statement: string, expected: string, description: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (sql(statement).trim() === expected) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timeout esperando ${description}`);
    };

    try {
      rows(`
        SELECT public.cleanup_rate_limit_events();
        DELETE FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
        INSERT INTO ip_rate_limit_events (ip_address, accepted_at)
        SELECT '${ip}'::inet, clock_timestamp() - INTERVAL '26 hours'
        FROM generate_series(1, 3);

        DROP TRIGGER IF EXISTS vf_cleanup_gate ON public.ip_rate_limit_events;
        DROP FUNCTION IF EXISTS public.vf_cleanup_gate();

        CREATE FUNCTION public.vf_cleanup_gate() RETURNS trigger
        LANGUAGE plpgsql AS $gate$
        BEGIN
          IF current_setting('vf.cleanup_gate', true) = 'wait' THEN
            PERFORM pg_advisory_lock(hashtextextended('vf.cleanup.release', 0));
          END IF;
          RETURN NULL;
        END;
        $gate$;

        CREATE TRIGGER vf_cleanup_gate
          BEFORE DELETE ON public.ip_rate_limit_events
          FOR EACH STATEMENT EXECUTE FUNCTION public.vf_cleanup_gate();
      `, 'cleanup-two-calls-setup');

      holder = execAsync(
        `docker exec -e PGAPPNAME=${lockHolderApp} ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SELECT pg_advisory_lock(hashtextextended('vf.cleanup.release', 0)); SELECT pg_sleep(120);"`
      );
      holder.catch(() => undefined);

      await waitFor(
        `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = '${lockHolderApp}';`,
        '1',
        'el lock de liberacion'
      );

      first = execAsync(
        `docker exec -e PGAPPNAME=${firstCleanupApp} ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SET vf.cleanup_gate = 'wait'; SELECT public.cleanup_rate_limit_events();"`
      );
      first.catch(() => undefined);

      await waitFor(
        `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE l.locktype = 'advisory' AND NOT l.granted AND a.application_name = '${firstCleanupApp}';`,
        '1',
        'la primera limpieza bloqueada en el gate'
      );

      const second = await execAsync(
        `docker exec -e PGAPPNAME=${secondCleanupApp} ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SELECT public.cleanup_rate_limit_events();"`
      );

      expect(second.stdout.trim()).toBe('0');

      terminate(lockHolderApp);

      const firstResult = await first;
      const firstOutput = firstResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      expect(firstOutput[firstOutput.length - 1]).toBe('3');

      const [remaining] = rows(`
        SELECT count(*) FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      `, 'cleanup-two-calls-check');

      expect(Number(remaining)).toBe(0);
    } finally {
      terminate(lockHolderApp);
      terminate(firstCleanupApp);
      terminate(secondCleanupApp);
      if (holder) {
        await holder.catch(() => undefined);
      }
      if (first) {
        await first.catch(() => undefined);
      }
      rows(`
        DROP TRIGGER IF EXISTS vf_cleanup_gate ON public.ip_rate_limit_events;
        DROP FUNCTION IF EXISTS public.vf_cleanup_gate();
        DELETE FROM ip_rate_limit_events WHERE ip_address = '${ip}'::inet;
      `, 'cleanup-two-calls-teardown');
    }
  }, 90000);

  it('cleanup_rate_limit_events esta restringida a service_role y mantiene RLS', () => {
    const signature = 'public.cleanup_rate_limit_events(interval,integer)';

    expect(sql(`SELECT has_function_privilege('anon', '${signature}', 'EXECUTE');`).trim()).toBe('f');
    expect(sql(`SELECT has_function_privilege('authenticated', '${signature}', 'EXECUTE');`).trim()).toBe('f');
    expect(sql(`SELECT has_function_privilege('service_role', '${signature}', 'EXECUTE');`).trim()).toBe('t');
    expect(
      sql("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ip_rate_limit_events'::regclass;").trim()
    ).toBe('t');
    expect(
      sql(
        "SELECT proconfig FROM pg_proc WHERE oid = 'public.cleanup_rate_limit_events(interval,integer)'::regprocedure;"
      ).trim()
    ).toContain('search_path=public, pg_temp');

    let failed = false;
    try {
      exec(
        `docker exec ${CONTAINER_NAME} psql -U testuser -d testdb -v ON_ERROR_STOP=1 -t -A -c "SET ROLE anon; SELECT public.cleanup_rate_limit_events();"`
      );
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      expect(message.toLowerCase()).toContain('permission denied');
    }
    expect(failed).toBe(true);
  });
});