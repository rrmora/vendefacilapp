# spec-t004-blindaje-antiproduccion

> Source: specs/features/generate-description/spec-t004.md (snapshot del repositorio vende-facil-app)
> Collected: 2026-10-27
> Published: Unknown

# Plan técnico — T-004: Cuotas, presupuesto y protección contra abuso

**Feature:** generate-description
**Fase:** 4
**Fecha:** 2026-10-11
**Estado:** Planificación (requiere aprobación)

## 1. Esquema SQL

### 1.1 Tabla `visitor_daily_quota`

```sql
CREATE TABLE visitor_daily_quota (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  quota_date DATE NOT NULL,
  generations_used INTEGER NOT NULL DEFAULT 0 CHECK (generations_used >= 0),
  max_generations INTEGER NOT NULL DEFAULT 5 CHECK (max_generations > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_visitor_daily UNIQUE (visitor_id, quota_date)
);

CREATE INDEX idx_quota_lookup ON visitor_daily_quota (visitor_id, quota_date);
```

### 1.2 Tabla `quota_reservations`

```sql
CREATE TABLE quota_reservations (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  reservation_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'released', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_reservation_id UNIQUE (reservation_id)
);

CREATE INDEX idx_reservations_pending ON quota_reservations (visitor_id, status)
  WHERE status = 'pending';
CREATE INDEX idx_reservations_expiry ON quota_reservations (expires_at)
  WHERE status = 'pending';
```

### 1.3 Tabla `generation_records`

```sql
CREATE TABLE generation_records (
  id BIGSERIAL PRIMARY KEY,
  visitor_id UUID NOT NULL,
  reservation_id UUID,
  success BOOLEAN NOT NULL,
  provider VARCHAR(50),
  model VARCHAR(100),
  tokens_input INTEGER,
  tokens_output INTEGER,
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  cost_estimated BOOLEAN NOT NULL DEFAULT false,
  error_code VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gen_visitor ON generation_records (visitor_id, created_at);
CREATE INDEX idx_gen_cost ON generation_records (created_at, estimated_cost_usd);
CREATE INDEX idx_gen_month ON generation_records (DATE_TRUNC('month', created_at));
```

### 1.4 Tabla `budget_tracking`

```sql
CREATE TABLE budget_tracking (
  id BIGSERIAL PRIMARY KEY,
  month VARCHAR(7) NOT NULL,
  total_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
  spent_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  reserved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_budget_month UNIQUE (month)
);
```

### 1.5 Tabla `ip_rate_limits`

```sql
CREATE TABLE ip_rate_limits (
  id BIGSERIAL PRIMARY KEY,
  ip_address INET NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_ip_window UNIQUE (ip_address, window_start)
);

CREATE INDEX idx_ip_lookup ON ip_rate_limits (ip_address, window_start);
```

## 2. Algoritmo transaccional de cuotas

**Definicion de `generations_used`:** cuota ocupada por generaciones
confirmadas y reservas pendientes. No representa exclusivamente
generaciones exitosas. `reserve_quota` incrementa al reservar;
`confirm_quota` no incrementa nuevamente; `release_quota` y
`expire_pending_reservations` decrementan unicamente reservas que
realmente estaban pendientes.

`expire_pending_reservations` agrupa las reservas vencidas por
`(visitor_id, quota_date)` antes de ajustar `visitor_daily_quota`, de modo que
un lote libera una unidad por reserva. Antes de T-004-8.1 solo se liberaba una
unidad por lote del mismo visitante y fecha.

Maximo 5 unidades de cuota ocupadas y 3 reservas pendientes
simultaneas por visitante.

`created_at` y `expires_at` de una reserva nueva siguen usando `NOW()`
dentro de `reserve_quota`: ahi interesa un unico instante consistente
para la transaccion que crea la reserva. Los timestamps de transicion
(`completed_at`, `updated_at` y la comparacion de expiracion) usan
`clock_timestamp()` porque deben reflejar el instante real de ejecucion,
no el inicio de una transaccion larga (T-004-8.2b).

### 2.1 Reservar cuota

```sql
-- Parametros: $1=visitor_id, $2=quota_date (YYYY-MM-DD), $3=reservation_id
BEGIN;

SELECT generations_used, max_generations
FROM visitor_daily_quota
WHERE visitor_id = $1 AND quota_date = $2
FOR UPDATE;

-- Si no existe fila: INSERT (visitor_id, quota_date, generations_used=1)
-- Si existe y generations_used < max_generations: UPDATE generations_used+1
-- Si existe y generations_used >= max_generations: ROLLBACK → QUOTA_EXCEEDED

SELECT COUNT(*) FROM quota_reservations
WHERE visitor_id = $1 AND status = 'pending';
-- Si >= 3: ROLLBACK → RATE_LIMITED

INSERT INTO quota_reservations (visitor_id, reservation_id, expires_at)
VALUES ($1, $3, NOW() + INTERVAL '5 minutes');

COMMIT;
RETURN reservation_id;
```

### 2.2 Confirmar reserva (generacion exitosa)

```sql
BEGIN;

UPDATE quota_reservations
SET status = 'completed',
    completed_at = GREATEST(clock_timestamp(), created_at)
WHERE reservation_id = $1 AND status = 'pending';

-- Si affected_rows = 0: reserva expirada o liberada previamente
COMMIT;
```

### 2.3 Liberar reserva (generacion fallida antes de consumir)

```sql
BEGIN;

WITH released AS (
  UPDATE quota_reservations
  SET status = 'released',
      completed_at = GREATEST(clock_timestamp(), created_at)
  WHERE reservation_id = $1 AND status = 'pending'
  RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
)
UPDATE visitor_daily_quota q
SET generations_used = GREATEST(q.generations_used - 1, 0),
    updated_at = clock_timestamp()
FROM released r
WHERE q.visitor_id = r.visitor_id
  AND q.quota_date = r.quota_date;

COMMIT;
```

### 2.4 Expiracion de reservas

```sql
BEGIN;

-- Reloj real de ejecucion capturado una sola vez.
v_now := clock_timestamp();

WITH expired AS (
  UPDATE quota_reservations
  SET status = 'expired',
      completed_at = GREATEST(v_now, created_at)
  WHERE status = 'pending' AND expires_at < v_now
  RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
),
released AS (
  SELECT visitor_id, quota_date, COUNT(*)::INTEGER AS units
  FROM expired
  GROUP BY visitor_id, quota_date
)
UPDATE visitor_daily_quota q
SET generations_used = GREATEST(q.generations_used - r.units, 0),
    updated_at = v_now
FROM released r
WHERE q.visitor_id = r.visitor_id
  AND q.quota_date = r.quota_date;

COMMIT;
```

### 2.5 Timestamps de transicion (T-004-8.2b)

`NOW()` es el inicio de la transaccion, no el instante de la instruccion. Las
transiciones de cuota deben usar `clock_timestamp()` para reflejar cuando
ocurrieron realmente. Esto aplica a:

- `completed_at` en `confirm_quota`, `release_quota` y
  `expire_pending_reservations`.
- La comparacion `expires_at < ...` de `expire_pending_reservations`, de modo
  que una transaccion larga tambien expira reservas vencidas durante su
  ejecucion.
- `updated_at` de `visitor_daily_quota` en liberacion y expiracion.

Para `completed_at` se usa `GREATEST(clock_timestamp(), created_at)` (o
`GREATEST(v_now, created_at)` en la expiracion). La cota inferior garantiza
`chk_completed_after_created` incluso si el reloj de pared retrocede por una
resincronizacion de hora. En `expire_pending_reservations` el reloj se captura
una sola vez (`v_now`) y se usa para decidir la expiracion y para
`completed_at`; como `chk_expires_after_created` exige
`expires_at > created_at`, toda fila elegible cumple `created_at < v_now`.

No se reemplaza `NOW()` en `created_at`/`expires_at` de `reserve_quota` ni en
calculos de periodos presupuestarios, donde se requiere un instante
consistente por transaccion.

## 3. Manejo de concurrencia y reservas expiradas

### 3.1 Condicion de carrera en cuota

El `SELECT ... FOR UPDATE` bloquea la fila del visitante. Dos solicitudes simultaneas: la primera bloquea y incrementa; la segunda espera, y al obtener el bloqueo ve el valor actualizado, evitando superar el limite.

### 3.2 Reservas pendientes simultaneas

Maximo 3 reservas `pending` por visitante. Si se supera, retornar 429 RATE_LIMITED.

### 3.3 Expiracion

- Job periodico cada 5 minutos ejecuta seccion 2.4.
- Verificacion bajo demanda antes de cada reserva.
- Reservas expiradas liberan la cuota correspondiente.

## 4. Reserva y conciliacion del presupuesto mensual

### 4.1 Costos por modelo (referencia, verificar antes de habilitar)

| Modelo | Input USD/1M | Output USD/1M | Max input | Max output |
|--------|-------------|---------------|-----------|------------|
| gemini-2.5-flash | $0.15 | $0.60 | 8192 | 1024 |
| llama-3.3-70b-versatile | $0.59 | $0.79 | 8192 | 1024 |
| gpt-4o-mini | $0.15 | $0.60 | 8192 | 1024 |

### 4.2 Reserva presupuestaria pre-generacion

Se calcula el costo maximo posible del modelo seleccionado:

```
max_cost = (max_input_tokens * input_price + max_output_tokens * output_price) / 1_000_000
```

Ejemplo gemini-2.5-flash: (8192 * 0.15 + 1024 * 0.60) / 1_000_000 = $0.0018432

```sql
BEGIN;

SELECT spent_usd, reserved_usd, total_budget_usd
FROM budget_tracking
WHERE month = $1
FOR UPDATE;

-- Si spent_usd + reserved_usd + max_cost >= total_budget_usd * 0.95
--   ROLLBACK → BUDGET_EXCEEDED

UPDATE budget_tracking
SET reserved_usd = reserved_usd + max_cost,
    updated_at = NOW()
WHERE month = $1;

COMMIT;
```

### 4.3 Conciliacion post-generacion

Cuando el proveedor reporta tokens:
```
actual_cost = (tokens_input * input_price + tokens_output * output_price) / 1_000_000
```

Cuando NO reporta tokens (error, timeout, consumo desconocido):
- Usar estimacion conservadora basada en tokens promedio del modelo (configurable por modelo, default 400 input + 200 output).
- Marcar `cost_estimated = true`.
- Registrar igualmente para contabilizar gasto potencial.

```sql
BEGIN;

UPDATE budget_tracking
SET spent_usd = spent_usd + actual_cost,
    reserved_usd = GREATEST(reserved_usd - reserved_cost, 0),
    updated_at = NOW()
WHERE month = $1;

COMMIT;
```

### 4.4 Fallback entre proveedores

Si el primer proveedor falla despues de consumir tokens:
- Registrar costo estimado del primer proveedor en `generation_records`.
- El segundo proveedor usa su propio `max_cost` para la reserva presupuestaria.
- Ambos costos se concilian contra el mismo presupuesto mensual.

### 4.5 Control de gasto desconocido

- Variable de entorno `AI_MAX_TOKENS_DEFAULT_INPUT` (default 400) y `AI_MAX_TOKENS_DEFAULT_OUTPUT` (default 200).
- Alerta log cuando el 80% del presupuesto mensual proviene de estimaciones.
- Metrica de estimaciones vs reales para calibrar defaults.

### 4.6 Conciliacion de reservas antiguas

- `reconcile_pending_budget_reservations(p_max_age INTERVAL DEFAULT '15 minutes')`
  confirma las reservas que llevan mas de `p_max_age` en estado `reserved`.
- Politica conservadora: se confirman con `actual_cost_usd = reserved_cost_usd` y
  `cost_estimated = TRUE`. No se libera presupuesto potencialmente consumido.
- Solo se procesan reservas en estado `reserved`, por lo que la ejecucion es
  idempotente y no pisa reservas ya confirmadas o liberadas.
- El ajuste de `budget_tracking` agrupa por `budget_month` antes de sumar, de modo
  que varias reservas del mismo mes se consolidan por la suma exacta. Antes de
  T-004-8.2 solo se aplicaba una de ellas.
- La transicion de estado y el ajuste de `budget_tracking` ocurren en una sola
  sentencia, con los mismos bloqueos de fila que usa `confirm_budget` y
  `release_budget`.
- `completed_at` se escribe con `clock_timestamp()` y no con `NOW()`: `NOW()` es
  el inicio de la transaccion y podria resultar anterior al `created_at` de una fila
  creada por otra transaccion.

## 5. Privacidad y retencion

### 5.1 Identificadores anonimos

- `visitor_id`: UUID v4 aleatorio, sin relacion con datos personales.
- No se almacena IP junto con visitor_id en la misma tabla.
- Retencion: 90 dias despues de ultima actividad.

### 5.2 IP para rate limiting

- Almacenada solo en `ip_rate_limits` durante la ventana activa.
- Retencion: 24 horas despues de ultima request.
- No se asocia con visitor_id.

### 5.3 Registros de generacion

- No se almacenan prompts completos ni datos de productos.
- Solo: visitor_id, tokens, costo, provider, modelo, exito/error.
- Retencion: 90 dias para auditoria de costos.

### 5.4 Job de limpieza (diario)

```sql
DELETE FROM visitor_daily_quota WHERE quota_date < CURRENT_DATE - INTERVAL '90 days';
DELETE FROM quota_reservations WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM generation_records WHERE created_at < NOW() - INTERVAL '90 days';
DELETE FROM ip_rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
```

## 6. Comportamiento fail-closed

### 6.1 Supabase no disponible

| Componente | Comportamiento |
|------------|----------------|
| Cuota | Retornar 503 INTERNAL_ERROR. No generar. |
| Rate limit | Retornar 503 INTERNAL_ERROR. No generar. |
| Presupuesto | Retornar 503 INTERNAL_ERROR. No generar. |
| Registro de consumo | Log local como fallback; reintentar despues. |

**Principio:** si no se puede verificar cuota, presupuesto o rate limit, no se genera.

### 6.2 Cascada de protecciones (D5)

Todas las siguientes condiciones deben cumplirse para realizar una llamada real:

1. `AI_ENABLED=true` (variable de entorno privada)
2. `AI_REAL_CALLS_ENABLED=true` (variable de entorno privada)
3. Al menos un proveedor habilitado con API key
4. Cuota disponible para el visitante
5. Rate limit IP no excedido
6. Presupuesto disponible
7. Proveedor de pago habilitado (si aplica)

Si cualquiera falla, no se genera. La autorización solo se activa mediante
configuración privada del servidor; no se acepta desde el body, cookies ni
cabeceras.

### 6.3 Errores de transaccion

- Reintento 1 vez con backoff (100ms).
- Timeout de conexion: 5 segundos. Timeout de query: 10 segundos.
- Si falla, retornar 503 INTERNAL_ERROR.

## 7. Pruebas de concurrencia y casos limite

### 7.1 Concurrencia de cuota
- 20 requests simultaneos del mismo visitor.
- Esperado: maximo 3 exitosos (limite de reservas pendientes),
  17 con RATE_LIMITED.
- Tras confirmar o liberar reservas, el visitante puede realizar
  nuevas solicitudes hasta alcanzar su cuota diaria de 5.
- Verificar que generations_used nunca excede 5.
- Un ciclo completo reserva→confirma alcanza exactamente 5
  generaciones exitosas en el dia.

### 7.2 Reservas expiradas
- Crear reserva, simular expiracion.
- Esperado: reserva marcada como expired, cuota liberada.

### 7.3 Falla de generacion
- Reservar cuota, simular error de proveedor antes de consumir.
- Esperado: reserva liberada, cuota decrementada.

### 7.4 Falla post-consumo
- Reservar cuota, simular proveedor que consume tokens pero retorna error 500.
- Esperado: reserva completada, costo estimado registrado, presupuesto conciliado.

### 7.5 Presupuesto agotado
- Configurar presupuesto cercano a limite, intentar generar.
- Esperado: BUDGET_EXCEEDED antes de llamar al proveedor.

### 7.6 Rate limit por IP
- 11 requests desde la misma IP en 1 minuto.
- Esperado: request 11 retorna 429 RATE_LIMITED.

### 7.7 Fail-closed
- Simular caida de Supabase en cuota, rate limit y presupuesto.
- Esperado: 503 INTERNAL_ERROR en todos los casos.

### 7.8 Fallback con consumo desconocido
- Primer proveedor falla con tokens consumidos, segundo proveedor exitoso.
- Esperado: costo estimado del primero registrado, costo real del segundo registrado, ambos conciliados.

### 7.9 Timestamps de transicion (T-004-8.2b)
- Transaccion iniciada antes de crear la reserva, que confirma o libera despues:
  esperado `completed_at >= created_at`, sin violar `chk_completed_after_created`.
- Transaccion larga que expira varias reservas creadas y vencidas durante su
  ejecucion: esperado que todas expiren y liberen su unidad de cuota.
- Concurrencia entre confirmacion, liberacion y expiracion: una sola transicion
  por reserva, cuota consistente y timestamps validos.
- Llamadas idempotentes: `completed_at` no cambia en la segunda llamada.
- Reloj de pared retrocedido: `GREATEST(..., created_at)` mantiene
  `completed_at >= created_at`.
- `sent_uncertain` sigue sin liberarse automaticamente; RLS y permisos EXECUTE
  restringidos a `service_role` se conservan.

### 7.10 Limpieza global de rate limit (T-004-8.3)
- Eventos con mas de 25 horas: se eliminan.
- Eventos con 23 horas y exactamente 24 horas: se conservan.
- Ejecuciones repetidas: la segunda retorna 0 y no modifica nada.
- Lote grande (2500 eventos, lotes de 100): al terminar no queda ningun evento
  elegible y el total retornado coincide con el sembrado.
- Concurrencia entre `cleanup_rate_limit_events` y `check_rate_limit`: la ventana
  reciente sigue siendo exacta, los eventos antiguos desaparecen y no hay
  errores de bloqueo.
- Dos limpiezas simultaneas: la primera mantiene el advisory lock mientras sigue
  activa; la segunda retorna 0 sin interferir y la primera elimina los eventos
  elegibles una sola vez.
- RLS activo, `search_path` seguro y `EXECUTE` restringido a `service_role`.

### 7.11 Auditoria del mantenimiento (T-004-8.4)
- Insercion con valores por defecto: `status = 'running'`, `started_at` con
  `clock_timestamp()` y `duration_ms = NULL`.
- Finalizacion con `success`, `partial` o `failed`: `finished_at` obligatorio y
  `duration_ms` derivada de `finished_at - started_at` (2500 ms y 1500 ms
  verificados).
- Estados invalidos, `running` con fin, estados finales sin fin, fin anterior
  al inicio y contadores negativos: rechazados por restricciones.
- `partial` y `failed` sin `error_details` util, o con un JSON que no sea
  objeto: rechazados. Un detalle por tarea se conserva como objeto JSON.
- RLS activa sin politicas; `anon` y `authenticated` no pueden leer, insertar,
  actualizar ni borrar; `service_role` puede insertar, leer y actualizar, pero
  no borrar.
- Privilegios efectivos de `service_role` sobre la tabla: exactamente `SELECT`,
  `INSERT` y `UPDATE`; sin `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`.
  La transicion `running` a un estado terminal se realiza con `UPDATE`.
- Secuencia: `service_role` tiene `USAGE` y `SELECT`; `anon` y `authenticated`
  no tienen `USAGE`, `SELECT` ni `UPDATE`. Intentos de `nextval` o de leer
  `last_value` como esos roles fallan con `permission denied for sequence`.
- La migracion no crea `run_maintenance` ni modifica tablas historicas.

## 8. Subtareas

### T-004-1: Modulo de identificacion de visitante
**Archivos:** `src/lib/visitors/visitorService.ts`, `tests/lib/visitors/visitorService.test.ts`
**Criterios:** UUID v4, cookie HttpOnly/SameSite=Lax/Secure, extraccion de request, tests.

### T-004-2: Cliente Supabase
**Archivos:** `src/lib/db/supabaseClient.ts`, `tests/lib/db/supabaseClient.test.ts`
**Criterios:** Conexion con env vars, timeout 5s, tests.

### T-004-3A: Esquema PostgreSQL y migraciones
**Archivos:** `supabase/migrations/*.sql`, `tests/integration/schema.test.ts`, `supabase/README.md`
**Criterios:** 5 tablas con claves, indices, restricciones. RLS activo. timestamptz. Estrategia America/Mexico_City. Pruebas de integridad.

### T-004-3: Modulo de cuota diaria
**Archivos:** `src/lib/quota/quotaService.ts`, `tests/lib/quota/quotaService.test.ts`
**Criterios:** Reserva atomica, confirmacion, liberacion, expiracion, limite 3 pendientes, tests.

### T-004-4: Modulo de rate limiting
**Archivos:** `src/lib/ratelimit/rateLimiter.ts`, `tests/lib/ratelimit/rateLimiter.test.ts`
**Criterios:** Sliding window, limites 10/100/500, tests.

### T-004-5: Modulo de presupuesto
**Archivos:** `src/lib/budget/budgetService.ts`, `tests/lib/budget/budgetService.test.ts`
**Criterios:** Calculo por modelo, reserva, conciliacion, estimacion sin tokens, tests.

### T-004-6: Integracion en descriptionService
**Archivos:** `src/lib/ai/descriptionService.ts`, `tests/api/generate.test.ts`
**Criterios:** Cascada de 6 protecciones, registro de consumo, tests de integracion.

### T-004-7: Pruebas de integracion y concurrencia
**Archivos:** `tests/integration/quota.test.ts`, `tests/integration/concurrency.test.ts`
**Criterios:** 20 concurrentes, expiracion, falla, fail-closed, fallback.

### T-004-8: Documentacion y validacion final
**Criterios:** MEMORY/CHANGELOG actualizados, lint/typecheck/test/build.

### T-004-8.3: Limpieza global de eventos de rate limit
**Archivos:** `supabase/migrations/022_cleanup_rate_limit_events.sql`,
`tests/integration/rate-limit-concurrency.test.ts`, `tests/integration/schema.test.ts`
**Criterios:** retencion minima de 25 h, borrado por lotes, concurrencia segura,
RLS y permisos de `service_role`, pruebas en PostgreSQL 17.

### T-004-8.4: Tabla de auditoria del mantenimiento
**Archivos:** `supabase/migrations/023_maintenance_runs.sql`,
`tests/integration/maintenance-runs.test.ts`, `tests/integration/schema.test.ts`
**Criterios:** registrar ejecuciones `running`/`success`/`partial`/`failed`,
contadores por tarea, duracion derivada, errores en JSON, RLS sin politicas y
permisos de `service_role`, pruebas en PostgreSQL 17. No crea
`run_maintenance`.
**Estado:** commit local e79dc86 (412/412); aprobacion de produccion pendiente.

### T-004-8.5: `run_maintenance` y limpieza con estado
**Archivos:** `supabase/migrations/024_cleanup_rate_limit_events_status.sql`,
`supabase/migrations/025_run_maintenance.sql`,
`tests/integration/run-maintenance.test.ts`, `tests/integration/schema.test.ts`,
`tests/integration/maintenance-runs.test.ts`
**Criterios:** distinguir limpieza `completed` de `already_running` mediante un
nucleo compartido con retorno JSONB y conservar el contrato `INTEGER`; orquestar
las tres tareas con lock global, bloque de excepcion por tarea, estados
`success`/`partial`/`failed` y auditoria en `maintenance_runs`; pruebas en
PostgreSQL 17.
**Estado:** implementado y validado localmente (434/434), sin commit; aprobacion
de commit pendiente.

## 9. Decisiones aprobadas

| ID | Decision | Estado |
|----|----------|--------|
| D1 | Zona horaria: America/Mexico_City, timestamps en UTC | Aprobada |
| D2 | Modelo Groq: posponer hasta verificar disponibilidad | Aprobada |
| D3 | Rate limit: 10/min, 100/hora, 500/dia | Aprobada |
| D4 | Presupuesto: calculo por modelo con max tokens, fallback, estimacion conservadora | Aprobada |
| D5 | Cascada AI_ENABLED + AI_REAL_CALLS_ENABLED + proveedor + cuota + presupuesto + disponibilidad | Aprobada |

## 10. Rate limiting por IP (T-004-4, T-004-7A)

- Límites: 10 solicitudes por 60 s, 100 por 3600 s y 500 por 86400 s.
- **Ventanas móviles reales (T-004-7A).** La RPC `check_rate_limit(INET)` ya no
  usa cubetas de calendario. Registra una fila por solicitud **aceptada** en
  `ip_rate_limit_events` (`ip_address INET`, `accepted_at TIMESTAMPTZ`, índice
  `(ip_address, accepted_at DESC)`) y decide contando los eventos dentro de
  cada ventana. Las solicitudes rechazadas no se registran.
- Semántica: para una solicitud evaluada en el instante `t`, la ventana es
  `(t - W, t]` (abierta a la izquierda, cerrada a la derecha). Se acepta si las
  aceptadas dentro de la ventana son menores al límite; en caso contrario se
  rechaza. Invariante: en todo instante, cualquier intervalo de 60 s contiene
  como máximo 10 solicitudes aceptadas de una misma IP.
- Instante límite: una aceptación hecha en `t0` deja de contar exactamente en
  `t0 + 60 s`; en ese instante una nueva solicitud sí se acepta.
- Simultáneas: las decisiones se serializan por IP con
  `pg_advisory_xact_lock(hashtextextended(ip, 0))`, de modo que de N solicitudes
  concurrentes se aceptan exactamente `min(N, 10 - A)`, sin depender del orden
  de llegada. El bloqueo se libera solo al confirmar, deshacer o lanzar
  excepción.
- `v_now := clock_timestamp()` se captura **una sola vez y después** de adquirir
  el bloqueo, para que la espera en cola no altere la ventana evaluada.
- Orden de evaluación: 60 s → 3600 s → 86400 s; se reporta la primera ventana
  violada. El contrato JSON no cambió (`status`, `window`, `limit`, `current`,
  `retry_after_seconds`, `counts`, `limits`), por lo que
  `src/lib/ratelimit/rateLimiter.ts` no requirió cambios.
- `SET search_path = public, pg_temp` en la función. `EXECUTE` revocado a
  `PUBLIC`, `anon` y `authenticated`; concedido a `service_role`. RLS activo
  en `ip_rate_limit_events` sin políticas (solo el servidor opera).
- La tabla legada `ip_rate_limits` y las migraciones `005` y `012` se conservan
  sin modificar; `ip_rate_limits` queda sin escritores. El comentario de `005`
  menciona "sliding window": en la implementación original era inexacto y en la
  actual sí describe el comportamiento.
- `TRUST_PROXY=false` por defecto; `X-Forwarded-For` solo se interpreta
  cuando se configura un proxy confiable. En el despliegue actual no hay
  proxy definido, por lo que la extracción devuelve `null` y el endpoint
  debe rechazar con fail-closed.
- IP ausente o inválida: el servicio retorna `invalid_ip`; no se permite
  generar sin IP verificada.
- PostgreSQL no disponible: `RateLimiterError` (fail-closed); no se omite
  el control.
- Limpieza: cada verificación elimina únicamente los eventos de esa IP con más
  de 24 horas (barrido acotado por índice). La limpieza global de eventos
  antiguos está implementada en `cleanup_rate_limit_events` (migración 022,
  T-004-8.3); su ejecución periódica sigue pendiente del scheduler (T-004-8.8).
- Riesgo documentado: la columna `ip_address INET` almacena la IP
  completa durante la ventana activa. Alternativa futura de HMAC requiere
  cambiar la columna a `TEXT`/`bytea` y añadir secreto del servidor;
  no aplicar sin autorización.
- No integrado todavía en `/api/generate` (T-004-6).

### 10.1 Limpieza global de eventos (T-004-8.3)

- `cleanup_rate_limit_events(p_retention INTERVAL DEFAULT INTERVAL '25 hours',
  p_batch_size INTEGER DEFAULT 1000)` elimina globalmente eventos de
  `ip_rate_limit_events`.
- Retención mínima de 25 h: 1 h de margen sobre la ventana móvil de 24 h para
  cubrir desfases de reloj. Una retención menor lanza excepción para que ninguna
  llamada borre eventos que `check_rate_limit` todavía necesita.
- Borrado por lotes: cada `DELETE` toma hasta `p_batch_size` filas elegibles con
  `FOR UPDATE SKIP LOCKED`; el bucle continúa hasta que no quedan eventos y
  retorna el total eliminado.
- La función se ejecuta en una sola transacción RPC. El lote acota el trabajo y
  los bloqueos por sentencia, no el tamaño total de la transacción. Un borrado
  en múltiples transacciones requeriría un procedimiento con `COMMIT` o el
  scheduler de T-004-8.8, fuera de este alcance.
- Concurrencia: `pg_try_advisory_xact_lock` serializa las limpiezas globales; si
  otra está activa, la llamada retorna 0 sin duplicar trabajo. `SKIP LOCKED`
  evita esperar por filas bloqueadas por `check_rate_limit` u otra limpieza.
- Índice nuevo `idx_ip_rate_events_accepted_at_id (accepted_at, id)` para el
  barrido global; se conserva `idx_ip_rate_events (ip_address, accepted_at DESC)`.
- No se modifica `check_rate_limit`: límites, ventanas, respuesta JSON y limpieza
  acotada por IP permanecen intactos.
- RLS activo sin políticas; `EXECUTE` revocado a `PUBLIC`, `anon` y
  `authenticated`, y concedido a `service_role`; `SET search_path = public, pg_temp`.
- Pruebas: eliminación de más de 25 h; conservación de 23 h y 24 h; idempotencia;
  2500 eventos procesados con lotes de 100; concurrencia con `check_rate_limit`;
  dos limpiezas simultáneas con advisory lock retenido; RLS y permisos RPC.
- La prueba de dos limpiezas es determinista: un gate transaccional mantiene la
  primera llamada activa y la segunda se ejecuta solo cuando la primera ya
  retiene el lock; no depende de pausas arbitrarias.
- Estado de validación: commits locales 844784d (390/390) y 1708ede (auditoría,
  391/391); sin push; aprobación de producción pendiente.

### 10.2 Auditoría del mantenimiento (T-004-8.4)

- `public.maintenance_runs` registra cada ejecución futura de `run_maintenance`.
  La migración `023_maintenance_runs.sql` crea solo el esquema; no implementa la
  función, endpoints ni schedulers.
- La especificación no define campos explícitos. El diseño cubre las tres tareas
  ya implementadas y las ejecuciones parciales o fallidas:
  `status` (`running`, `success`, `partial`, `failed`), contadores
  `expired_quota_reservations`, `reconciled_budget_reservations` y
  `deleted_rate_limit_events`, y `error_details` como objeto JSON por tarea.
- `started_at` usa `clock_timestamp()`; `finished_at` es nullable mientras la
  ejecución está en curso. `duration_ms` es una columna generada y almacenada
  (`finished_at - started_at` en ms), nula mientras `status = 'running'`.
- Restricciones: fin posterior o igual al inicio; coherencia exacta entre
  `status = 'running'` y `finished_at IS NULL`; `partial` y `failed` exigen
  `error_details` no vacío; contadores no negativos.
- Índices: `idx_maintenance_runs_started_at (started_at DESC)` para historial e
  `idx_maintenance_runs_running (started_at) WHERE status = 'running'`.
- RLS activo sin políticas. Tabla y secuencia revocadas a `PUBLIC`, `anon` y
  `authenticated`; `service_role` recibe `SELECT, INSERT, UPDATE` y
  `USAGE, SELECT` sobre la secuencia. No se otorga `DELETE`: la tabla es un
  registro de auditoría. La transición de `running` a un estado terminal se hace
  con `UPDATE`; no se añadió trigger de inmutabilidad porque bloquearía esa
  transición.
- Permisos efectivos comprobados en runtime: `service_role` tiene exactamente
  `SELECT, INSERT, UPDATE` sobre la tabla, puede completar una ejecución
  `running` y no puede borrarla. `anon` y `authenticated` no tienen privilegios
  de tabla ni de secuencia; sus intentos de `nextval` y `last_value` fallan.
- Pruebas: 13 de integración en PostgreSQL 17 y 8 estáticas de la migración 023.
  Cubren defaults, duración, restricciones, RLS, privilegios efectivos de
  `service_role`, denegación de `DELETE`, privilegios de secuencia y ausencia de
  `run_maintenance`.
- Validación: 412/412 pruebas; lint, typecheck y build exitosos. Sin cambios en
  `src/**`, contratos públicos ni migraciones históricas.
- Estado: commit local e79dc86; sin push; aprobación de producción pendiente. La
  migración 023 no implementa `run_maintenance`; eso corresponde a T-004-8.5.

### 10.3 `run_maintenance` y limpieza con estado (T-004-8.5)

- `cleanup_rate_limit_events` (022) retornaba `INTEGER 0` tanto cuando no había
  eventos elegibles como cuando otra limpieza retenía el advisory lock, por lo
  que no era posible distinguir una tarea omitida por concurrencia. La migración
  `024_cleanup_rate_limit_events_status.sql` extrae la lógica común a
  `public.cleanup_rate_limit_events_core(INTERVAL, INTEGER) RETURNS JSONB` y
  agrega `public.cleanup_rate_limit_events_status(...) RETURNS JSONB`. El núcleo
  adquiere el advisory lock una sola vez y retorna `{"status":"completed",
  "deleted":N}` o `{"status":"already_running","deleted":0}`.
- `public.cleanup_rate_limit_events(...) RETURNS INTEGER` conserva firma,
  validaciones (retención mínima de 25 h, lote ≥ 1) y semántica: retorna el total
  eliminado o `0` si la limpieza fue omitida. No se cambia silenciosamente el
  tipo de retorno de la función pública existente.
- `public.run_maintenance() RETURNS JSONB` (migración
  `025_run_maintenance.sql`) es una `FUNCTION` transaccional, sin parámetros y
  `SECURITY INVOKER` con `SET search_path = public, pg_temp`. Coordina en orden
  `expire_pending_reservations()`,
  `reconcile_pending_budget_reservations()` y
  `cleanup_rate_limit_events_status()`.
- Concurrencia: `pg_try_advisory_xact_lock(hashtextextended(
  'public.run_maintenance', 0))`. Si el lock global está ocupado retorna
  exactamente `{"run_id":null,"status":"already_running"}` sin insertar
  auditoría.
- Auditoría: inserta una fila `running` en `maintenance_runs`, ejecuta cada tarea
  en un bloque `EXCEPTION` independiente para que un fallo revierta solo su
  subtransacción y actualiza la fila al terminar. No hay commits parciales ni
  `PROCEDURE`. Si la transacción completa se revierte (error fatal, cancelación,
  caída de conexión), la auditoría también se revierte.
- Limpieza omitida: si el estado es `already_running`, la tarea cuenta como
  fallida/omitida, `deleted_rate_limit_events` queda en `0` y `error_details`
  registra `status = already_running`.
- Estado terminal: `success` con 0 tareas fallidas, `partial` con 1 o 2 y
  `failed` con 3. `finished_at = GREATEST(clock_timestamp(), started_at)` y
  `duration_ms` se deriva de la columna generada.
- Errores: `GET STACKED DIAGNOSTICS` captura `RETURNED_SQLSTATE` y
  `MESSAGE_TEXT` por tarea, sin secretos ni datos personales. `WHEN OTHERS` no
  captura `QUERY_CANCELED` ni `ASSERT_FAILURE`: un timeout o una cancelación
  abortan la transacción completa y no dejan auditoría.
- `EXECUTE` de `run_maintenance`, del núcleo y de la variante de estado se
  revoca a `PUBLIC`, `anon` y `authenticated` y se concede a `service_role`.
  `SECURITY INVOKER`: el ejecutor necesita además los privilegios de las tareas
  y de `maintenance_runs`.
- Hallazgo: en un PostgreSQL limpio con 001-025, `service_role` tenía `EXECUTE`
  en las tres tareas, pero carecía de privilegios de tabla sobre
  `visitor_daily_quota`, `quota_reservations`, `generation_records` y
  `budget_tracking`. Por eso `run_maintenance` como `service_role` registraba
  `partial` (`expire` y `reconcile` fallan con SQLSTATE 42501; `cleanup` se
  completa). Se mantiene `SECURITY INVOKER` sin elevar privilegios; los grants se
  resolvieron en T-004-8.5b (migración 026).
- T-004-8.5b (migración `026_minimum_privileges.sql`): concede a `service_role`
  los privilegios mínimos verificados (no `GRANT ALL`), revoca de forma dirigida
  `PUBLIC`, `anon` y `authenticated` sobre las tablas y secuencias afectadas y
  restringe `EXECUTE` de las 16 RPC a `service_role`. No redefine funciones, no
  usa `SECURITY DEFINER`, no crea roles y no modifica RLS.
- Grants a `service_role` (026): `visitor_daily_quota`, `quota_reservations` y
  `budget_tracking` con `SELECT, INSERT, UPDATE`; `generation_records` con
  `SELECT, INSERT`; `USAGE` en las seis secuencias asociadas. Normalización:
  revoca `DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` en las cuatro tablas,
  `UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` en `generation_records`,
  `DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` en `budget_reservations`,
  `TRUNCATE`/`REFERENCES`/`TRIGGER` en `ip_rate_limit_events` (conserva `UPDATE`
  porque `cleanup_rate_limit_events` usa `FOR UPDATE SKIP LOCKED`) y
  `SELECT`/`UPDATE` en las seis secuencias.
- Pruebas: 10 de integración de T-004-8.5 en PostgreSQL 17, 12 estáticas de las
  migraciones 024/025 y 12 de integración de T-004-8.5b en
  `tests/integration/privileges.test.ts` con los defaults de Supabase simulados
  (rol sonda `vf_public_probe`). Las de 8.5b cubren over-grant antes de 026,
  corrección tras 026, ausencia de privilegios de tabla y secuencia para
  `anon`/`authenticated`/`PUBLIC`, privilegios mínimos de `service_role`,
  `EXECUTE` restringido de las 16 RPC, RLS activa sin políticas, flujos legítimos
  del backend, `run_maintenance` en `success` y denegación a
  `anon`/`authenticated` de `run_maintenance`, `reserve_quota`, `INSERT` y
  `TRUNCATE`.
- Validación: 434/434 pruebas de T-004-8.5; lint, typecheck y build exitosos;
  T-004-8.5b añade 12 integraciones y actualiza `run-maintenance.test.ts` y
  `schema.test.ts` (26 migraciones). Sin cambios en `src/**`, contratos públicos,
  endpoints ni migraciones históricas 001-025.
- Estado: implementado y validado localmente, sin commit y sin push; aprobación
  de commit pendiente.

## 11. Bloqueantes de producción (Fase 4)

- **BLOQUEANTE — aprobación de producción de T-004-6/T-004-7/T-004-7A/T-004-8.1/T-004-8.2/T-004-8.2b/T-004-8.3.**
  La integración en `/api/generate`, la protección persistente de resultado
  incierto, el rate limit de ventana móvil, las correcciones de expiración de
  cuota, de reconciliación de presupuesto y de timestamps de transición, y la
  limpieza global de eventos de rate limit están implementadas y validadas
  localmente (commits 844784d y 1708ede; 391/391), pero no aprobadas para
  producción. `AI_ENABLED=false` y `AI_REAL_CALLS_ENABLED=false` se mantienen.
- **APROBACIÓN PENDIENTE — T-004-8.4.** La tabla `maintenance_runs` (023) está
  implementada y validada localmente (412/412) y committeada en e79dc86, pero sin
  push. No requiere aprobación de producción porque aún no escribe datos por sí
  sola.
- **PENDIENTE DE COMMIT — T-004-8.5 y T-004-8.5b.** `run_maintenance` (025), la
  limpieza con estado (024) y los privilegios mínimos (026) están implementados y
  validados localmente, pero sin commit ni push. Requieren revisión y
  autorización de commit.
- **BLOQUEANTE — programación automática ausente.** La limpieza global ya existe
  como RPC `cleanup_rate_limit_events` (022) y `run_maintenance` (025) ya
  coordina las tres tareas y escribe `maintenance_runs` (023), pero sin un job
  periódico no se ejecuta automáticamente; tampoco se consolidan solas las
  reservas de cuota ni de presupuesto. Afecta crecimiento de tabla y liberación
  tardía de cuota.
- **RESUELTO en T-004-8.5b — privilegios de ejecución en producción.** La
  migración `026_minimum_privileges.sql` concede a `service_role` `EXECUTE` en
  las tareas y en las 16 RPC, los privilegios de tabla mínimos sobre
  `visitor_daily_quota`, `quota_reservations`, `generation_records` y
  `budget_tracking` y `USAGE` en las secuencias, además de revocar `PUBLIC`,
  `anon` y `authenticated`. Con ello `run_maintenance` como `service_role`
  registra `success` en un PostgreSQL limpio y en un entorno con los defaults de
  Supabase, sin elevar privilegios (`SECURITY INVOKER` se mantiene).
- **PENDIENTE — mecanismo automático de reconciliación de reservas.** No
  existe un job que invoque periódicamente `expire_pending_reservations()` y
  `reconcile_pending_budget_reservations()`. Hoy la reconciliación solo ocurre
  de forma reactiva; las reservas `pending` vencidas y las reservas de
  presupuesto antiguas permanecen sin consolidar hasta que se programe el job.
- **RESUELTO en T-004-8.3 — limpieza global de eventos de rate limit.**
  La migración `022_cleanup_rate_limit_events.sql` agrega
  `cleanup_rate_limit_events` con retención mínima de 25 h, borrado por lotes,
  advisory lock, índice de barrido global y permisos de `service_role`. Queda
  pendiente su programación periódica (T-004-8.8).
- **PENDIENTE — mecanismo automático de reconciliación de reservas.** No
  existe un job que invoque periódicamente `expire_pending_reservations()` y
  `reconcile_pending_budget_reservations()`. Hoy la reconciliación solo ocurre
  de forma reactiva; las reservas `pending` vencidas y las reservas de
  presupuesto antiguas permanecen sin consolidar hasta que se programe el job.
- **RESUELTO en T-004-8.2b — `completed_at` con `NOW()` en las RPC de cuota.**
  La migración `021_fix_quota_transition_timestamps.sql` reemplaza `NOW()` por
  `clock_timestamp()` en `confirm_quota`, `release_quota` y
  `expire_pending_reservations`, y acota `completed_at` con
  `GREATEST(..., created_at)`. `mark_quota_sent` no escribe `completed_at`, por
  lo que no requirió cambios. La corrección se reprodujo y validó en PostgreSQL
  17, incluyendo transacciones iniciadas antes de la creación de la reserva,
  expiración de varias reservas en una transacción larga y concurrencia entre
  confirmación, liberación y expiración.
- **PENDIENTE — verificación del estado del modelo predeterminado de Groq**
  (fase T-003A).

## 12. Restricciones

- No instalar dependencias hasta aprobacion final.
- No crear tablas ni migraciones hasta aprobacion final.
- No modificar codigo hasta aprobacion final.
- No habilitar llamadas reales hasta validar controles.
- No consumir creditos.
- No modificar RF-008.
- No modificar contratos publicos.
