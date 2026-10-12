# Migraciones Supabase — VendeFácil AI

## Aplicar migraciones

```bash
# Opcion 1: Supabase CLI (recomendado)
supabase db push

# Opcion 2: aplicacion manual desde dashboard
# 1. Abrir Supabase Dashboard -> SQL Editor
# 2. Copiar contenido de cada archivo en orden
# 3. Ejecutar
```

## Verificar migraciones

```sql
-- Verificar tablas creadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Verificar RLS activo
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public';

-- Verificar indices
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

## Revertir migraciones

```sql
-- Revertir en orden inverso
DROP TABLE IF EXISTS ip_rate_limits CASCADE;
DROP TABLE IF EXISTS budget_tracking CASCADE;
DROP TABLE IF EXISTS generation_records CASCADE;
DROP TABLE IF EXISTS quota_reservations CASCADE;
DROP TABLE IF EXISTS visitor_daily_quota CASCADE;
```

## Estrategia de cuota America/Mexico_City

La fecha de cuota se calcula en UTC-6 (sin horario de verano):

```sql
-- Fecha de cuota actual en America/Mexico_City
SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date;
```

## Notas de seguridad

- RLS activo en todas las tablas.
- Clientes anonimos NO tienen acceso directo.
- Solo el servidor (service_role) puede operar.
- Las migraciones son idempotentes (IF NOT EXISTS).
