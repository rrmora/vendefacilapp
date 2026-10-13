import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

function readAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map(readMigration).join('\n');
}

describe('schema migrations', () => {
  describe('archivos de migracion', () => {
    it('contiene 12 archivos SQL', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
      expect(files).toHaveLength(12);
    });

    it('nombres de migracion ordenados correctamente', () => {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(files[0]).toMatch(/^001_/);
      expect(files[10]).toMatch(/^011_/);
      expect(files[11]).toMatch(/^012_/);
    });
  });

  describe('tabla visitor_daily_quota', () => {
    const sql = readMigration('001_create_visitor_daily_quota.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS visitor_daily_quota');
    });

    it('tiene clave primaria', () => {
      expect(sql).toContain('id BIGSERIAL PRIMARY KEY');
    });

    it('tiene visitor_id UUID', () => {
      expect(sql).toContain('visitor_id UUID NOT NULL');
    });

    it('tiene quota_date DATE', () => {
      expect(sql).toContain('quota_date DATE NOT NULL');
    });

    it('tiene generations_used con default 0', () => {
      expect(sql).toContain('generations_used INTEGER NOT NULL DEFAULT 0');
    });

    it('tiene max_generations con default 5', () => {
      expect(sql).toContain('max_generations INTEGER NOT NULL DEFAULT 5');
    });

    it('tiene restriccion generations_used >= 0', () => {
      expect(sql).toContain('CHECK (generations_used >= 0)');
    });

    it('tiene restriccion max_generations > 0', () => {
      expect(sql).toContain('CHECK (max_generations > 0)');
    });

    it('tiene unicidad visitor_id + quota_date', () => {
      expect(sql).toContain('UNIQUE (visitor_id, quota_date)');
    });

    it('usa timestamptz', () => {
      expect(sql).toContain('TIMESTAMPTZ');
    });

    it('tiene indice de lookup', () => {
      expect(sql).toContain('idx_quota_lookup');
    });
  });

  describe('tabla quota_reservations', () => {
    const sql = readMigration('002_create_quota_reservations.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS quota_reservations');
    });

    it('tiene estados validos', () => {
      expect(sql).toContain("'pending'");
      expect(sql).toContain("'completed'");
      expect(sql).toContain("'released'");
      expect(sql).toContain("'expired'");
    });

    it('tiene reservation_id unico', () => {
      expect(sql).toContain('UNIQUE (reservation_id)');
    });

    it('tiene expires_at', () => {
      expect(sql).toContain('expires_at TIMESTAMPTZ NOT NULL');
    });

    it('tiene restriccion expires_at > created_at', () => {
      expect(sql).toContain('CHECK (expires_at > created_at)');
    });

    it('tiene indice de pendientes', () => {
      expect(sql).toContain('idx_reservations_pending');
    });

    it('tiene indice de expiracion', () => {
      expect(sql).toContain('idx_reservations_expiry');
    });
  });

  describe('tabla generation_records', () => {
    const sql = readMigration('003_create_generation_records.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS generation_records');
    });

    it('tiene success BOOLEAN', () => {
      expect(sql).toContain('success BOOLEAN NOT NULL');
    });

    it('tiene tokens_input y tokens_output', () => {
      expect(sql).toContain('tokens_input INTEGER');
      expect(sql).toContain('tokens_output INTEGER');
    });

    it('tiene estimated_cost_usd', () => {
      expect(sql).toContain('estimated_cost_usd NUMERIC(10, 6)');
    });

    it('tiene cost_estimated flag', () => {
      expect(sql).toContain('cost_estimated BOOLEAN');
    });

    it('tiene foranea a quota_reservations', () => {
      expect(sql).toContain('FOREIGN KEY (reservation_id)');
      expect(sql).toContain('REFERENCES quota_reservations (reservation_id)');
    });

    it('tiene ON DELETE SET NULL', () => {
      expect(sql).toContain('ON DELETE SET NULL');
    });

    it('tiene indice de costo', () => {
      expect(sql).toContain('idx_gen_cost');
    });
  });

  describe('tabla budget_tracking', () => {
    const sql = readMigration('004_create_budget_tracking.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS budget_tracking');
    });

    it('tiene month VARCHAR(7)', () => {
      expect(sql).toContain('month VARCHAR(7) NOT NULL');
    });

    it('tiene total_budget_usd default 5.00', () => {
      expect(sql).toContain('total_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5.00');
    });

    it('tiene spent_usd', () => {
      expect(sql).toContain('spent_usd NUMERIC(10, 6)');
    });

    it('tiene reserved_usd', () => {
      expect(sql).toContain('reserved_usd NUMERIC(10, 6)');
    });

    it('tiene restriccion de formato month', () => {
      expect(sql).toContain("CHECK (month ~ '^[0-9]{4}-[0-9]{2}$')");
    });

    it('tiene unicidad por mes', () => {
      expect(sql).toContain('UNIQUE (month)');
    });
  });

  describe('tabla ip_rate_limits', () => {
    const sql = readMigration('005_create_ip_rate_limits.sql');

    it('crea la tabla', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS ip_rate_limits');
    });

    it('tiene ip_address INET', () => {
      expect(sql).toContain('ip_address INET NOT NULL');
    });

    it('tiene window_start TIMESTAMPTZ', () => {
      expect(sql).toContain('window_start TIMESTAMPTZ NOT NULL');
    });

    it('tiene request_count', () => {
      expect(sql).toContain('request_count INTEGER');
    });

    it('tiene unicidad ip + window', () => {
      expect(sql).toContain('UNIQUE (ip_address, window_start)');
    });
  });

  describe('RLS', () => {
    const sql = readMigration('006_enable_rls.sql');

    it('activa RLS en visitor_daily_quota', () => {
      expect(sql).toContain('ALTER TABLE visitor_daily_quota ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en quota_reservations', () => {
      expect(sql).toContain('ALTER TABLE quota_reservations ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en generation_records', () => {
      expect(sql).toContain('ALTER TABLE generation_records ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en budget_tracking', () => {
      expect(sql).toContain('ALTER TABLE budget_tracking ENABLE ROW LEVEL SECURITY');
    });

    it('activa RLS en ip_rate_limits', () => {
      expect(sql).toContain('ALTER TABLE ip_rate_limits ENABLE ROW LEVEL SECURITY');
    });
  });

  describe('consistencia del esquema', () => {
    const allSql = readAllMigrations();

    it('todas las tablas usan timestamptz', () => {
      const tables = [
        'visitor_daily_quota',
        'quota_reservations',
        'generation_records',
        'budget_tracking',
        'ip_rate_limits',
      ];

      for (const table of tables) {
        const tableSection = allSql.split(`CREATE TABLE IF NOT EXISTS ${table}`)[1]?.split(');')[0] || '';
        expect(tableSection).toContain('TIMESTAMPTZ');
      }
    });

    it('no usa TIMESTAMP sin zona horaria', () => {
      const lines = allSql.split('\n');
      const timestampLines = lines.filter((line) =>
        /\bTIMESTAMP\b/i.test(line) && !/\bTIMESTAMPTZ\b/i.test(line)
      );
      expect(timestampLines).toHaveLength(0);
    });

    it('generation_records referencia quota_reservations', () => {
      expect(allSql).toContain('REFERENCES quota_reservations (reservation_id)');
    });

    it('budget_tracking separa spent de reserved', () => {
      expect(allSql).toContain('spent_usd');
      expect(allSql).toContain('reserved_usd');
    });
  });
});
