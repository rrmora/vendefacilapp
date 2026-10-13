# MEMORY â€” VendeFÃ¡cil AI

## Estado actual del proyecto

Fase 4 â€” Cuotas, presupuesto y protecciÃ³n contra abuso (T-004).
T-004-1, T-004-2, T-004-3A, T-004-3, T-004-4 y T-004-5 completadas.
T-004-6 a T-004-8 pendientes.
Stack: Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3 (strict),
Tailwind CSS 4.3.3, Zod 4.6.5, Vitest 5.0.3, @testing-library/react
16.3.3, happy-dom 20.14.5, pnpm 12.4.2, Node.js 24.21.0.

## Fase activa

T-004-5 â€” MÃ³dulo de presupuesto (pendiente de aprobaciÃ³n).

## Ãšltima tarea completada

T-004-5 - Modulo de presupuesto y costos IA (2026-10-13).

## Fase 3 â€” Cierre

T-003A completada. Arquitectura de proveedores de IA documentada y
validada. 151 pruebas, lint/typecheck/build exitosos.

**Estado operativo:**
- Adaptadores implementados: Gemini (gemini-2.5-flash), Groq
  (llama-3.3-70b-versatile), OpenAI (gpt-4o-mini).
- Llamadas reales deshabilitadas: AI_ENABLED=false (default) y
  realCallsAuthorized=false (flag interno en cÃ³digo).
- Contratos pÃºblicos intactos: IDescriptionRequest/IDescriptionResponse.
- Endpoint /api/generate conserva respuesta MOCK.
- Pendiente: revisiÃ³n modelo predeterminado Groq (estado Enterprise).

## T-004-1 â€” MÃ³dulo de identificaciÃ³n de visitante

- `src/lib/visitors/visitorService.ts`: generaciÃ³n de visitorId
  UUID v4, validaciÃ³n, extracciÃ³n de cookie y helper
  `getOrCreateVisitorId`.
- Cookie `visitor_id` con HttpOnly, SameSite=Lax, Secure en
  producciÃ³n, Path=/, Max-Age 1 aÃ±o.
- Tests: 14 unitarias. Total: 165/165.
- Sin dependencias nuevas, sin migraciones, sin llamadas reales,
  sin cambios en contratos pÃºblicos.

## T-004-3A â€” Esquema PostgreSQL y migraciones

- 6 migraciones SQL en `supabase/migrations/`: visitor_daily_quota,
  quota_reservations, generation_records, budget_tracking,
  ip_rate_limits, RLS.
- `tests/integration/schema.test.ts`: 33 pruebas estÃ¡ticas de
  esquema (validaciÃ³n de sintaxis SQL por contenido de archivo).
- ValidaciÃ³n real en PostgreSQL 17-alpine (Docker): 6 migraciones
  aplicadas exitosamente, 5 tablas, 20 Ã­ndices, restricciones
  verificadas (CHECK, UNIQUE, FOREIGN KEY), RLS activo, roles
  anon/authenticated sin acceso.
- Corregido: Ã­ndice `idx_gen_month` reemplazado por `idx_gen_created_at`
  (B-tree sobre created_at) por error IMMUTABLE en PostgreSQL 17.
- Total: 250/250.

## T-004-3 â€” MÃ³dulo de cuota diaria

- `src/lib/quota/quotaService.ts`: reserveQuota, confirmQuota,
  releaseQuota, getQuotaStatus. Fecha de cuota en
  America/Mexico_City, timestamps UTC.
- Funciones RPC PostgreSQL (migraciones 007-011):
  reserve_quota, confirm_quota, release_quota, get_quota_status,
  expire_pending_reservations.
- Atomicidad: SELECT FOR UPDATE serializa la cuota; nunca se
  superan 5 unidades de cuota ocupadas por visitante por dÃ­a.
- generations_used = generaciones confirmadas + reservas
  pendientes (no solo generaciones exitosas).
- DecisiÃ³n aprobada (opciÃ³n 1): mÃ¡ximo 3 reservas pendientes
  simultÃ¡neas. Una rÃ¡faga de 20 produce 3 reservas y 17
  rate_limited; tras confirmar/liberar se alcanzan las 5.
- Idempotencia: confirmaciÃ³n y liberaciÃ³n duplicadas retornan
  already_processed sin doble efecto.
- CorrecciÃ³n de fechas: release_quota y
  expire_pending_reservations derivan quota_date desde
  created_at en America/Mexico_City (no usan CURRENT_DATE),
  liberando la cuota del dÃ­a original aunque la operaciÃ³n
  ocurra despuÃ©s de medianoche.
- Permisos: REVOKE EXECUTE FROM PUBLIC en las 5 RPC; solo
  el servidor (owner/service_role) puede ejecutarlas.
- Fail-closed: si Supabase no responde, lanza QuotaServiceError
  (no se genera).
- Pruebas: 16 unitarias con mocks + 8 de concurrencia reales
  contra PostgreSQL 17-alpine en Docker (20 simultÃ¡neas, ciclo
  completo hasta 5, liberaciÃ³n, idempotencia, lÃ­mite pendientes,
  2 regresiÃ³n de cambio de dÃ­a).
- Total: 252/252.
- Pendiente: integrar quotaService en /api/generate (T-004-6).

## T-004-4 â€” MÃ³dulo de rate limiting por IP

- `src/lib/ratelimit/rateLimiter.ts`: `checkRateLimit`, `normalizeIpAddress`,
  `extractClientIp`, `RateLimiterError`.
- FunciÃ³n RPC PostgreSQL (`supabase/migrations/012_check_rate_limit.sql`):
  `check_rate_limit(INET)`. Ventanas fijas por minuto (10), hora (100) y
  dÃ­a (500); atomicidad mediante SELECT FOR UPDATE por cubeta.
- Limpieza de registros con mÃ¡s de 24 horas en cada verificaciÃ³n.
- ValidaciÃ³n defensiva de IPv4/IPv6 con `net.isIP`.
- ExtracciÃ³n de IP solo con proxy confiable (`TRUST_PROXY`) desde
  encabezados como `x-real-ip`, `cf-connecting-ip` y Ãºltimo salto vÃ¡lido
  de `x-forwarded-for`; sin proxy confiable retorna null.
- Fail-closed: `RateLimiterError` cuando Supabase/RPC falla.
- Pruebas: 11 unitarias + 2 integraciÃ³n real contra PostgreSQL 17-alpine
  (20 solicitudes simultÃ¡neas: 10 permitidas, 10 rechazadas; IPs
  independientes).
- Total: 265/265.
- Decisiones: retenciÃ³n INET aprobada sin pseudonimizaciÃ³n HMAC adicional
  (requerirÃ­a cambio de esquema, no aplicado todavÃ­a); rate limiting no
  integrado en `/api/generate` aÃºn (T-004-6/T-004-7).

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
- Decisiones: budget_tracking existente insuficiente para idempotencia; se agreg� budget_reservations; no se cambi� esquema INET.


- Seguridad (T-004-5): migracion 014 habilita RLS en budget_reservations y revoca permisos/EXECUTE para anon, authenticated y PUBLIC.
- Decisiones de presupuesto:
  * Umbral operativo 4.75/5.00 efectivo; reservas que lo alcanzan o superan se rechazan.
  * Timeout posterior al envio se considera consumo potencial y se concilia conservadoramente, no se libera.
  * No liberar reservas si se desconoce el consumo.
  * Cada intento de fallback requiere su propia reserva.
  * Si el costo real supera el reservado, registrar el costo incurrido.
  * Si el gasto registrado supera el umbral, bloquear futuras reservas.

## Decisiones arquitectonicas

- (T-001) Next.js 16.4.0 + React 19.3.0; TS 5.9.3 sobre 7.0.2;
  Tailwind v4 vÃ­a Turbopack; endpoint MOCK determinista.
- (T-002) D1: testing-library + happy-dom. D2: schema Zod compartido.
  D3: regeneraciÃ³n sin cambio de contrato. CopyState derivado sin
  useEffect. Mocks de clipboard tras userEvent.setup().
- (T-003A) D1 fetch nativo (sin SDKs); D2 estructura en `src/lib/ai/`;
  D3 cero reintentos por proveedor; D4 timeout individual 15s;
  D6 `AI_ENABLED=false` por defecto; D8 modelos
  gemini-2.5-flash / llama-3.3-70b-versatile / gpt-4o-mini
  (configurables, por verificar).
- (T-003A ajustes) Timeout global 25s ademÃ¡s del individual; el
  orquestador (T-003A-7) respetarÃ¡ tiempo restante y cancelaciÃ³n
  del cliente. Fallback permitido en AUTH_ERROR/NOT_CONFIGURED del
  proveedor; no en SECURITY_BLOCK ni BUDGET_EXCEEDED. `variant`
  permanece interno: el frontend y el contrato pÃºblicos actuales no
  permiten distinguir de manera fiable cada regeneraciÃ³n. BUDGET_EXCEEDED
  preservado para T-004 (no se convierte en PROVIDER_UNAVAILABLE).
  RF-008 (AdSense) intacto.
- (T-003A-2) Prompt builder puro, sin logging ni exposiciÃ³n de
  datos; delimitadores neutralizados en notas; bloque de datos con
  instrucciÃ³n explÃ­cita de ignorar instrucciones internas.
- (T-004, decisiÃ³n previa 2026-10-09) Sin autenticaciÃ³n obligatoria en
  el MVP. IdentificaciÃ³n anÃ³nima por cookie HttpOnly, SameSite=Lax y
  Secure en producciÃ³n, con ID aleatorio generado por el servidor.
  Cuota inicial de 5 generaciones exitosas por visitante por dÃ­a
  (incluye regeneraciones). Contador en servidor (no localStorage).
  Reservas atÃ³micas contra concurrencia; liberaciÃ³n en fallo. Rate
  limiting por IP con lÃ­mites independientes de la cuota. Controles
  globales de concurrencia y presupuesto. Registro de consumo
  facturable incluso en fallos post-consumo. Sin fingerprinting
  invasivo. Sin registro obligatorio. Se documenta expresamente que
  cambiar de navegador, dispositivo o borrar cookies permite obtener
  nueva identidad anÃ³nima: objetivo es reducir abuso, no impedirlo.
  NO se implementa en T-003A; requiere plan tÃ©cnico de T-004.

## Bloqueos

Ninguno.

## Siguiente tarea propuesta

T-004-6 - Integracion en descriptionService (src/lib/ai/descriptionService.ts).
Requiere aprobacion expresa del usuario.
