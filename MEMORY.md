# MEMORY — VendeFácil AI

## Estado actual del proyecto

Fase 4 — Cuotas, presupuesto y protección contra abuso (T-004).
T-004-1, T-004-2, T-004-3A, T-004-3, T-004-4, T-004-5 y T-004-6 completadas.
T-004-7, T-004-7A y T-004-8.1 implementadas localmente (354/354, 10/10 corridas completas de
`pnpm test` en verde); T-004-8 pendiente y sin iniciar.
Stack: Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3 (strict),
Tailwind CSS 4.3.3, Zod 4.6.5, Vitest 5.0.3, @testing-library/react
16.3.3, happy-dom 20.14.5, pnpm 12.4.2, Node.js 24.21.0.

## Fase activa

T-004-8.1 - Corrección de expiración de cuota (implementada localmente, no aprobada para producción).

## Última tarea completada

T-004-8.1 - Corrección de expiración de cuota: agrupación de reservas vencidas
por visitante y fecha antes de liberar cuota (implementada localmente, no
aprobada para producción, 2026-10-16).

## Fase 3 — Cierre

T-003A completada. Arquitectura de proveedores de IA documentada y
validada. 151 pruebas, lint/typecheck/build exitosos.

**Estado operativo:**
- Adaptadores implementados: Gemini (gemini-2.5-flash), Groq
  (llama-3.3-70b-versatile), OpenAI (gpt-4o-mini).
- Llamadas reales deshabilitadas: AI_ENABLED=false (default) y
  realCallsAuthorized=false (flag interno en código).
- Contratos públicos intactos: IDescriptionRequest/IDescriptionResponse.
- Endpoint /api/generate conserva respuesta MOCK.
- Pendiente: revisión modelo predeterminado Groq (estado Enterprise).

## T-004-1 — Módulo de identificación de visitante

- `src/lib/visitors/visitorService.ts`: generación de visitorId
  UUID v4, validación, extracción de cookie y helper
  `getOrCreateVisitorId`.
- Cookie `visitor_id` con HttpOnly, SameSite=Lax, Secure en
  producción, Path=/, Max-Age 1 año.
- Tests: 14 unitarias. Total: 165/165.
- Sin dependencias nuevas, sin migraciones, sin llamadas reales,
  sin cambios en contratos públicos.

## T-004-3A — Esquema PostgreSQL y migraciones

- 6 migraciones SQL en `supabase/migrations/`: visitor_daily_quota,
  quota_reservations, generation_records, budget_tracking,
  ip_rate_limits, RLS.
- `tests/integration/schema.test.ts`: 33 pruebas estáticas de
  esquema (validación de sintaxis SQL por contenido de archivo).
- Validación real en PostgreSQL 17-alpine (Docker): 6 migraciones
  aplicadas exitosamente, 5 tablas, 20 índices, restricciones
  verificadas (CHECK, UNIQUE, FOREIGN KEY), RLS activo, roles
  anon/authenticated sin acceso.
- Corregido: índice `idx_gen_month` reemplazado por `idx_gen_created_at`
  (B-tree sobre created_at) por error IMMUTABLE en PostgreSQL 17.
- Total: 250/250.

## T-004-3 — Módulo de cuota diaria

- `src/lib/quota/quotaService.ts`: reserveQuota, confirmQuota,
  releaseQuota, getQuotaStatus. Fecha de cuota en
  America/Mexico_City, timestamps UTC.
- Funciones RPC PostgreSQL (migraciones 007-011):
  reserve_quota, confirm_quota, release_quota, get_quota_status,
  expire_pending_reservations.
- Atomicidad: SELECT FOR UPDATE serializa la cuota; nunca se
  superan 5 unidades de cuota ocupadas por visitante por día.
- generations_used = generaciones confirmadas + reservas
  pendientes (no solo generaciones exitosas).
- Decisión aprobada (opción 1): máximo 3 reservas pendientes
  simultáneas. Una ráfaga de 20 produce 3 reservas y 17
  rate_limited; tras confirmar/liberar se alcanzan las 5.
- Idempotencia: confirmación y liberación duplicadas retornan
  already_processed sin doble efecto.
- Corrección de fechas: release_quota y
  expire_pending_reservations derivan quota_date desde
  created_at en America/Mexico_City (no usan CURRENT_DATE),
  liberando la cuota del día original aunque la operación
  ocurra después de medianoche.
- Permisos: REVOKE EXECUTE FROM PUBLIC en las 5 RPC; solo
  el servidor (owner/service_role) puede ejecutarlas.
- Fail-closed: si Supabase no responde, lanza QuotaServiceError
  (no se genera).
- Pruebas: 16 unitarias con mocks + 8 de concurrencia reales
  contra PostgreSQL 17-alpine en Docker (20 simultáneas, ciclo
  completo hasta 5, liberación, idempotencia, límite pendientes,
  2 regresión de cambio de día).
- Total: 252/252.
- Pendiente: integrar quotaService en /api/generate (T-004-6).

## T-004-4 — Módulo de rate limiting por IP

- `src/lib/ratelimit/rateLimiter.ts`: `checkRateLimit`, `normalizeIpAddress`,
  `extractClientIp`, `RateLimiterError`.
- Función RPC PostgreSQL (`supabase/migrations/012_check_rate_limit.sql`):
  `check_rate_limit(INET)`. Ventanas fijas por minuto (10), hora (100) y
  día (500); atomicidad mediante SELECT FOR UPDATE por cubeta.
- Limpieza de registros con más de 24 horas en cada verificación.
- Validación defensiva de IPv4/IPv6 con `net.isIP`.
- Extracción de IP solo con proxy confiable (`TRUST_PROXY`) desde
  encabezados como `x-real-ip`, `cf-connecting-ip` y último salto válido
  de `x-forwarded-for`; sin proxy confiable retorna null.
- Fail-closed: `RateLimiterError` cuando Supabase/RPC falla.
- Pruebas: 11 unitarias + 2 integración real contra PostgreSQL 17-alpine
  (20 solicitudes simultáneas: 10 permitidas, 10 rechazadas; IPs
  independientes).
- Total: 265/265.
- Decisiones: retención INET aprobada sin pseudonimización HMAC adicional
  (requeriría cambio de esquema, no aplicado todavía); rate limiting no
  integrado en `/api/generate` aún (T-004-6/T-004-7).

## T-004-5 - Modulo de presupuesto y costos IA

- src/lib/budget/budgetService.ts: reserveBudget, confirmBudget, releaseBudget, getBudgetStatus.
- Funciones RPC PostgreSQL (supabase/migrations/013_budget_reservations.sql): reserve_budget, confirm_budget, release_budget, get_budget_status.
- Tabla budget_reservations para idempotencia por reservation_id.
- Presupuesto mensual UTC con umbral 95% (spent+reserved+maxCost >= total*0.95).
- Confirmacion y liberacion idempotentes.
- Costos por modelo segun tabla de spec; costo maximo por max tokens; costo actual por tokens o estimacion conservadora 400/200.
- Fail-closed: BudgetServiceError cuando Supabase/RPC falla.
- Pruebas: 13 unitarias + 2 integracion real PostgreSQL 17 (9 permitidas, 1 excedida en 10 intentos; idempotencia confirmacion).
- Total: 287/287.
- Decisiones: budget_tracking existente insuficiente para idempotencia; se agregó budget_reservations; no se cambió esquema INET.


- Seguridad (T-004-5): migracion 014 habilita RLS en budget_reservations y revoca permisos/EXECUTE para anon, authenticated y PUBLIC.
- Decisiones de presupuesto:
  * Umbral operativo 4.75/5.00 efectivo; reservas que lo alcanzan o superan se rechazan.
  * Timeout posterior al envio se considera consumo potencial y se concilia conservadoramente, no se libera.
  * No liberar reservas si se desconoce el consumo.
  * Cada intento de fallback requiere su propia reserva.
  * Si el costo real supera el reservado, registrar el costo incurrido.
  * Si el gasto registrado supera el umbral, bloquear futuras reservas.

## T-004-6 - Integracion en /api/generate (implementado localmente, no aprobado para produccion)

- Archivos: route.ts, descriptionService.ts, orchestrator.ts, generationRecordService.ts.
- Compensaciones: cuota reservada antes de generación; liberada si todos los proveedores fallan, inclusive presupuesto potencialmente consumido se preserva.
- Pruebas focalizadas T-004.6: A-P principales cubiertas en tests/api/generate.t004-6.test.ts (13 casos).
- Resultado verificado: 302 pruebas aprobadas y 0 omitidas, incluida la prueba automatizada de reconciliación PostgreSQL.
- Hallazgos: timeout/POST-envío se trata como potencial consumo; confirmación de presupuesto y quota resuelta antes de responder éxito; no se alteraron contratos.

- IA_ENABLED=false y realCallsAuthorized=false se mantienen; no se habilitan llamadas reales.
- Causa confirmada y corregida del harness PostgreSQL: comandos SQL multilínea y fecha de cuota fija desfasada. Ahora usa fixture SQL con `docker cp` + `psql -f` y `CURRENT_DATE`.
- Riesgo de producción mitigado en T-004-7 con el estado persistente `sent_uncertain` (migración 017): la expiración ya no libera reservas enviadas a IA.
## Reconciliacion T-004-6

- Reintentos sincronicos acotados (3 intentos) para confirmQuota y confirmBudget.
- expire_pending_reservations no decrementa cuota en reservas asociadas a generation_records exitosas; las marca completed de forma conservadora.
- reconcile_pending_budget_reservations(INTERVAL, default 15 minutos) confirma reservas budget_reservations antiguas de forma idempotente.
- No se libera presupuesto potencialmente consumido; la reconciliacion conserva el monto comprometido.
- Reconciliacion exclusivamente interna, sin endpoints publicos.

## T-004-7 - Integracion y concurrencia (implementada localmente, no aprobada para produccion)

**Parte A — harness de reconciliación real**
- `tests/integration/reconciliation.test.ts`: se eliminó `describe.skip`; los fixtures
  SQL viajan por `docker cp` + `psql -f` (los comandos multilínea con `-c` fallaban) y
  usan `CURRENT_DATE` (la fecha fija quedó desfasada).
- 3 pruebas reales contra PostgreSQL 17-alpine: reserva `pending` con
  `generation_records.success=true` no se libera al expirar; reserva `pending` sin
  registro exitoso expira y libera; `reconcile_pending_budget_reservations` es
  idempotente.

**Parte B — protección persistente para resultado incierto**
- `supabase/migrations/017_quota_reservation_protection.sql`: CHECK de estados ampliado
  con `sent_uncertain`; nueva RPC `mark_quota_sent(UUID)`; `confirm_quota` y
  `release_quota` aceptan `pending` y `sent_uncertain`;
  `expire_pending_reservations` completa (nunca libera) las reservas inciertas y solo
  expira las `pending`. `EXECUTE` revocado a `PUBLIC`, `anon` y `authenticated`, y
  concedido a `service_role`.
- `quotaService.markQuotaSent`: 3 reintentos acotados y `QuotaServiceError` (fail-closed).
- `descriptionService`: marca la reserva como enviada antes de invocar al orquestador;
  si el marcado falla responde 503 sin llamar a ningún proveedor.
- `orchestrator`: propaga `consumptionUnknown`; con consumo incierto la cuota no se
  libera aunque el fallback termine en error.
- Recuperación tras reinicio: una reserva `sent_uncertain` sin registro exitoso nunca
  se libera automáticamente (queda consumida, máximo 5 unidades por día). Si existe
  `generation_records.success=true`, la reconciliación la marca `completed`.

**Pruebas agregadas (20)**
- 6 unitarias de `markQuotaSent` (incluye recuperación tras fallo transitorio).
- 5 de integración del ciclo `sent_uncertain` contra PostgreSQL 17.
- 3 de concurrencia con 20 llamadas simultáneas: `mark_quota_sent`, `confirm_quota` y
  `release_quota` producen una sola transición y una sola unidad consumida o liberada.
- 5 estáticas de la migración 017 y 1 de API (fail-closed sin llamar al proveedor).
- Total: 324/324. Lint, typecheck y build exitosos.
- Ejecuciones de validación: 10/10 corridas completas de `pnpm test` sin fallos.

**Cierre técnico — corrección de la prueba intermitente de rate limiting**
- Causa raíz 1 (prueba): `check_rate_limit` NO usa ventana móvil; usa cubetas fijas
  alineadas con `date_trunc('minute'|'hour'|'day', NOW())`. La prueba asumía que las
  20 llamadas caerían en una sola cubeta de minuto, algo que no está garantizado cuando
  la ráfaga cruza el cambio de minuto ( entonces hasta 20 solicitudes pueden ser
  aceptadas en dos cubetas).
- Solución 1: la ráfaga se ejecuta con 20 procesos `psql` concurrentes dentro del
  contenedor (script copiado con `docker cp`), alineada al inicio de un minuto con al
  menos 30 s de margen, y las aserciones se apoyan en el estado persistido
  (`COUNT(*)=3` filas minuto/hora/día con 10 cada una, `MAX=10`, `SUM=30`), que es
  invariante en el tiempo y detecta cualquier cubeta extra. Se mantienen las
  aserciones estrictas 10 permitidas / 10 rechazadas.
- Pruebas adicionales: contractual de `rate_limited` (semilla + llamada en una sola
  transacción, para eliminar la carrera de cambio de minuto) y una que documenta que
  las cubetas son de calendario (el minuto anterior no descuenta el actual).
- Causa raíz 2 (harness): los cinco harnesses de integración usaban `pg_isready`, que
  acepta conexiones durante el servidor efímero del entrypoint de PostgreSQL; el
  siguiente comando podía fallar con `the database system is shutting down` y, en el
  caso de la ráfaga,Requests se servían contra un servidor reiniciado (17 aceptadas).
  Solución: sonda con consulta real (`SELECT 1`) y 3 respuestas consecutivas
  (~2 s) antes de aplicar migraciones, en `budget-concurrency`, `budget-security`,
  `quota-concurrency`, `rate-limit-concurrency` y `reconciliation`.
- Validación: 10/10 ejecuciones consecutivas de `pnpm test` en verde (324/324 cada una),
  más 12 ejecuciones instrumentadas y 15 ejecuciones aisladas de la prueba de rate limit.
- Límites de producción (10/100/500) y lógica SQL NO fueron modificados.

**Pendiente / riesgos**
- Resuelto en T-004-7A: el límite de 10 por cualquier intervalo móvil de 60 s.
- PENDIENTE: mecanismo automático de reconciliación de reservas. No existe un job
  que invoque periódicamente `expire_pending_reservations()` ni
  `reconcile_pending_budget_reservations()`; hoy la consolidación solo es reactiva y
  las reservas `pending` vencidas y de presupuesto antiguas permanecen sin consolidar
  hasta que se programe.

## T-004-7A - Rate limiting con ventana movil real (local, no aprobado para produccion)

- `supabase/migrations/018_sliding_window_rate_limit.sql` (nueva; 005 y 012 intactas).
- Tabla `ip_rate_limit_events (id, ip_address INET, accepted_at TIMESTAMPTZ)` con
  indice `(ip_address, accepted_at DESC)`; una fila por solicitud ACEPTADA.
- `CREATE OR REPLACE FUNCTION public.check_rate_limit(INET)`: ventanas moviles
  `(t - W, t]` de 60 s, 3600 s y 86400 s con limites 10/100/500.
  - Serializacion por IP con `pg_advisory_xact_lock(hashtextextended(ip::text, 0))`.
  - `v_now := clock_timestamp()` capturado una sola vez DESPUES del bloqueo.
  - Orden de evaluacion 60 s -> 3600 s -> 86400 s; se reporta la primera violada.
  - `retry_after_seconds = ceil(mas antiguo de la ventana + W - t)`, minimo 1.
  - Las solicitudes rechazadas no se registran.
  - `SET search_path = public, pg_temp`; `EXECUTE` revocado a PUBLIC/anon/authenticated
    y concedido a service_role; RLS activo en la tabla nueva sin politicas.
  - Limpieza acotada a la IP en el hot path (`> 24 h`); la limpieza GLOBAL de eventos
    requiere el job pendiente.
- Contrato JSON identico: `rateLimiter.ts` no se modifico; se agregaron pruebas que
  fijan el nombre de la RPC y sus parametros.
- Migraciones 005 y 012 sin modificar; la tabla legada `ip_rate_limits` se conserva
  sin escritores.
- Pruebas nuevas (21): 9 de ventana movil (20 concurrentes = 10/10, cruce de minuto,
  fronteras exactas de 60 s, limites moviles de hora y dia, counts, retry_after,
  expiracion a 24 h, IPs independientes) y 5 de permisos/RLS en tiempo de ejecucion;
  9 estaticas de la migracion 018; 2 de contrato en `rateLimiter.test.ts`.
- La prueba de rafaga ya no necesita alinearse al inicio de un minuto: con ventana
  movil el cruce de calendario es irrelevante.
- Total: 345/345. Lint, typecheck y build exitosos. 12/12 corridas completas de
  `pnpm test` en verde.
- Sin cambios en `src/lib/**` ni en contratos publicos. AI_ENABLED=false y
  realCallsAuthorized=false.

**Pendiente / riesgos (T-004-7A)**
- Sin job de limpieza, los eventos de IPs que dejan de volver no se eliminan: la tabla
  crece. Se estiman hasta 500 filas por IP y dia con retencion de 24 h.
- Los limites de hora y dia son ahora mas estrictos en las fronteras (sin rafaga);
  es intencional y esta documentado.
- `ip_rate_limits` queda sin escritores; si alguna herramienta externa la leyera,
  veria datos obsoletos.

## T-004-8.1 - Correccion de expiracion de cuota (local, no aprobado para produccion)

- `supabase/migrations/019_fix_quota_expiration.sql` (nueva; 001-018 intactas).
- Causa raiz: `expire_pending_reservations` liberaba cuota con
  `UPDATE visitor_daily_quota q ... FROM expired e`. En PostgreSQL, cuando varias
  filas de la fuente coinciden con la misma fila destino, solo se aplica UNA
  actualizacion: un lote de N reservas vencidas del mismo visitante y fecha
  liberaba una sola unidad de cuota.
- Correccion: se agrupan las reservas expiradas por `(visitor_id, quota_date)` y se
  resta el conteo. Firma (sin parametros) y retorno `INTEGER` conservados.
- Se mantienen sin cambios: `sent_uncertain` nunca se libera automaticamente; las
  reservas `pending` o `sent_uncertain` con `generation_records.success = TRUE` se
  marcan `completed` sin decrementar cuota; `quota_date` se deriva de `created_at`
  en America/Mexico_City.
- Se anadio `SET search_path = public, pg_temp` a la funcion; `EXECUTE` revocado a
  PUBLIC/anon/authenticated y concedido a service_role.
- Reproduccion verificada en PostgreSQL 17: con 3 reservas vencidas del mismo
  visitante y dia, sin 019 `generations_used` queda en 2; con 019 queda en 0.
- Pruebas nuevas (5): liberacion de una unidad por reserva (3 reservas mismo
  visitante/dia), agrupacion por visitante y por fecha, ejecucion repetida sin
  doble decremento, concurrencia entre expiracion y confirmacion, y permisos/RLS
  en tiempo de ejecucion. 4 pruebas estaticas de la migracion 019.
- **Defecto de pruebas detectado y corregido**: las pruebas de reconciliacion
  sembraban `visitor_daily_quota` con `CURRENT_DATE` (fecha UTC del contenedor)
  mientras `release_quota` y `expire_pending_reservations` derivan la fecha en
  America/Mexico_City. Entre 00:00 y 06:00 UTC ambas fechas difieren y las
  pruebas fallaban aunque el codigo fuera correcto. Ahora usan
  `(NOW() AT TIME ZONE 'America/Mexico_City')::DATE`, igual que produccion.
- Total: 354/354. Lint, typecheck y build exitosos. 10/10 corridas completas en verde.
- Sin cambios en `src/lib/**` ni en contratos publicos.

**Pendiente (T-004-8)**
- T-004-8.2: mismo defecto en `reconcile_pending_budget_reservations` (el gasto se
  subcontaba y `reserved_usd` quedaba inflado). No autorizado todavia.
- Processos programado, limpieza global de eventos y job de reconciliacion.

## Decisiones arquitectonicas

- (T-001) Next.js 16.4.0 + React 19.3.0; TS 5.9.3 sobre 7.0.2;
  Tailwind v4 vía Turbopack; endpoint MOCK determinista.
- (T-002) D1: testing-library + happy-dom. D2: schema Zod compartido.
  D3: regeneración sin cambio de contrato. CopyState derivado sin
  useEffect. Mocks de clipboard tras userEvent.setup().
- (T-003A) D1 fetch nativo (sin SDKs); D2 estructura en `src/lib/ai/`;
  D3 cero reintentos por proveedor; D4 timeout individual 15s;
  D6 `AI_ENABLED=false` por defecto; D8 modelos
  gemini-2.5-flash / llama-3.3-70b-versatile / gpt-4o-mini
  (configurables, por verificar).
- (T-003A ajustes) Timeout global 25s además del individual; el
  orquestador (T-003A-7) respetará tiempo restante y cancelación
  del cliente. Fallback permitido en AUTH_ERROR/NOT_CONFIGURED del
  proveedor; no en SECURITY_BLOCK ni BUDGET_EXCEEDED. `variant`
  permanece interno: el frontend y el contrato públicos actuales no
  permiten distinguir de manera fiable cada regeneración. BUDGET_EXCEEDED
  preservado para T-004 (no se convierte en PROVIDER_UNAVAILABLE).
  RF-008 (AdSense) intacto.
- (T-003A-2) Prompt builder puro, sin logging ni exposición de
  datos; delimitadores neutralizados en notas; bloque de datos con
  instrucción explícita de ignorar instrucciones internas.
- (T-004, decisión previa 2026-10-09) Sin autenticación obligatoria en
  el MVP. Identificación anónima por cookie HttpOnly, SameSite=Lax y
  Secure en producción, con ID aleatorio generado por el servidor.
  Cuota inicial de 5 generaciones exitosas por visitante por día
  (incluye regeneraciones). Contador en servidor (no localStorage).
  Reservas atómicas contra concurrencia; liberación en fallo. Rate
  limiting por IP con límites independientes de la cuota. Controles
  globales de concurrencia y presupuesto. Registro de consumo
  facturable incluso en fallos post-consumo. Sin fingerprinting
  invasivo. Sin registro obligatorio. Se documenta expresamente que
  cambiar de navegador, dispositivo o borrar cookies permite obtener
  nueva identidad anónima: objetivo es reducir abuso, no impedirlo.
  NO se implementa en T-003A; requiere plan técnico de T-004.

## Bloqueos

**Bloqueantes de producción (Fase 4):**
1. T-004-6, T-004-7 y T-004-7A implementadas y validadas localmente (345/345),
   pero sin aprobación para producción. `AI_ENABLED=false` y
   `realCallsAuthorized=false`.
2. Limpieza automática ausente: sin job periódico, los eventos de
   `ip_rate_limit_events` de IPs que no regresan no se eliminan y las reservas de
   cuota y presupuesto no se consolidan.

**Pendientes:**
1. Mecanismo automático de reconciliación de reservas y de limpieza de eventos.
2. Verificación del modelo predeterminado de Groq.

## Siguiente tarea propuesta

T-004-8 - Documentacion y validacion final (MEMORY/CHANGELOG, lint/typecheck/test/build).
Requiere aprobacion expresa del usuario. No iniciar sin autorizacion.

