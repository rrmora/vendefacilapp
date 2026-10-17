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
SET status = 'completed', completed_at = NOW()
WHERE reservation_id = $1 AND status = 'pending';

-- Si affected_rows = 0: reserva expirada o liberada previamente
COMMIT;
```

### 2.3 Liberar reserva (generacion fallida antes de consumir)

```sql
BEGIN;

WITH released AS (
  UPDATE quota_reservations
  SET status = 'released', completed_at = NOW()
  WHERE reservation_id = $1 AND status = 'pending'
  RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
)
UPDATE visitor_daily_quota q
SET generations_used = GREATEST(q.generations_used - 1, 0),
    updated_at = NOW()
FROM released r
WHERE q.visitor_id = r.visitor_id
  AND q.quota_date = r.quota_date;

COMMIT;
```

### 2.4 Expiracion de reservas

```sql
BEGIN;

WITH expired AS (
  UPDATE quota_reservations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < NOW()
  RETURNING visitor_id, (created_at AT TIME ZONE 'America/Mexico_City')::DATE AS quota_date
)
UPDATE visitor_daily_quota q
SET generations_used = GREATEST(q.generations_used - 1, 0),
    updated_at = NOW()
FROM expired e
WHERE q.visitor_id = e.visitor_id
  AND q.quota_date = e.quota_date;

COMMIT;
```

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

1. `AI_ENABLED=true` (variable de entorno)
2. `realCallsAuthorized=true` (flag en codigo)
3. Cuota disponible para el visitante
4. Rate limit IP no excedido
5. Presupuesto disponible
6. Proveedor de pago habilitado (si aplica)

Si cualquiera falla, no se genera. No existe mecanismo para saltarse estos controles.

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

## 9. Decisiones aprobadas

| ID | Decision | Estado |
|----|----------|--------|
| D1 | Zona horaria: America/Mexico_City, timestamps en UTC | Aprobada |
| D2 | Modelo Groq: posponer hasta verificar disponibilidad | Aprobada |
| D3 | Rate limit: 10/min, 100/hora, 500/dia | Aprobada |
| D4 | Presupuesto: calculo por modelo con max tokens, fallback, estimacion conservadora | Aprobada |
| D5 | Cascada AI_ENABLED + realCallsAuthorized + cuota + presupuesto + disponibilidad | Aprobada |

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
  de 24 horas (barrido acotado por índice). **La limpieza global de eventos
  antiguos requiere el job externo pendiente (pg_cron/cron del host), igual que
  la reconciliación de reservas.**
- Riesgo documentado: la columna `ip_address INET` almacena la IP
  completa durante la ventana activa. Alternativa futura de HMAC requiere
  cambiar la columna a `TEXT`/`bytea` y añadir secreto del servidor;
  no aplicar sin autorización.
- No integrado todavía en `/api/generate` (T-004-6).

## 11. Bloqueantes de producción (Fase 4)

- **BLOQUEANTE — aprobación de producción de T-004-6/T-004-7/T-004-7A/T-004-8.1.**
  La integración en `/api/generate`, la protección persistente de resultado
  incierto, el rate limit de ventana móvil y la corrección de expiración de cuota
  están implementados y validados localmente (354/354), pero no aprobados para
  producción. `AI_ENABLED=false` y `realCallsAuthorized=false` se mantienen.
- **BLOQUEANTE — limpieza automática ausente.** Sin un job periódico, los
  eventos de `ip_rate_limit_events` de IPs que dejan de volver no se eliminan
  (la RPC solo limpia la IP que consulta) y tampoco se consolidan las reservas
  de cuota ni de presupuesto. Afecta crecimiento de tabla y liberación tardía
  de cuota.
- **PENDIENTE — mecanismo automático de reconciliación de reservas.** No
  existe un job que invoque periódicamente `expire_pending_reservations()` y
  `reconcile_pending_budget_reservations()`. Hoy la reconciliación solo ocurre
  de forma reactiva; las reservas `pending` vencidas y las reservas de
  presupuesto antiguas permanecen sin consolidar hasta que se programe el job.
- **PENDIENTE — `reconcile_pending_budget_reservations` corrige el mismo defecto
  de `UPDATE ... FROM` (T-004-8.2).** Con varias reservas vencidas del mismo mes
  el gasto se subcuenta y `reserved_usd` queda inflado. No se debe activar el
  proceso programado antes de corregirlo.
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
