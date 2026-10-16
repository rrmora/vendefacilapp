# CHANGELOG — VendeFácil AI

Registro de cambios importantes del proyecto. El estado operativo actual vive en `MEMORY.md`.

## 2026-10-09 — T-001: Scaffolding

- Inicialización de `vendefacil-pwa` con Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3
  (strict), Tailwind CSS 4.3.3, ESLint 9, pnpm 12.4.2.
- Estructura modular con directorio `src/` y alias `@/*`.
- Dependencias añadidas: `zod` 4.6.5 (runtime), `vitest` 5.0.3 (dev).
- Archivos de contexto: `CONSTITUTION.md`, `AGENTS.md`, `MEMORY.md`, `CHANGELOG.md`, `.env.example`.
- Especificaciones iniciales: `specs/product/PRD.md`,
  `specs/features/generate-description/{spec.md, plan.md, tasks.md}`.
- Contratos públicos en `src/types/description.ts`.
- Endpoint `POST /api/generate` con validación Zod y respuesta MOCK (sin proveedores externos).

## 2026-10-09 — T-002: Formulario Mobile-First (Fase 2)

- Formulario de exactamente cuatro campos en español, mobile-first:
  categoría (select), estado (radiogroup, default `buen_estado`),
  notas (textarea 3–500 con contador), precio negociable (checkbox).
- Schema Zod centralizado en
  `src/features/description/schemas/description.schema.ts` y
  reutilizado por el endpoint (D2). Contratos públicos intactos.
- Servicio `generateDescription` (`features/description/services/`).
- Componentes: `DescriptionForm` (máquina de estados idle/submitting/
  success/error), `DescriptionResult` (copiar con fallback manual,
  regenerar con última solicitud exitosa — D3), `CategorySelect`,
  `ConditionSelector`, `ProductNotesField`, `NegotiablePriceField`,
  `ui/Field`.
- Estados de carga con skeleton y `aria-busy`; errores en español
  sin detalles técnicos; datos del formulario conservados.
- DevDeps de testing (D1): @testing-library/react 16.3.3,
  user-event 14.6.7, jest-dom 7.0.1, happy-dom 20.14.5;
  `@types/node` 24.19.1; `"type": "module"`; `vitest.config.ts`
  con alias `@/` y `tests/setup.ts`.
- RF-008 (monetización publicitaria) registrado en el PRD: diseño
  de ubicación futura en Fase 2; integración real en Fase 6.
- Validaciones: lint ✓, typecheck ✓, tests 37/37 ✓, build ✓.

## 2026-10-09 — T-003A-1: Contratos internos y clasificación de errores (Fase 3)

- `src/lib/ai/types.ts`: interfaz `IAIProvider`, `AIProviderName`,
  solicitud/resultado internos y `AIProviderCallContext` (timeout
  individual, tiempo restante global, señal de cancelación del cliente).
  `variant` documentado como contrato interno exclusivo.
- `src/lib/ai/errors.ts`: `AIProviderErrorKind` (RATE_LIMITED,
  PROVIDER_ERROR, AUTH_ERROR, NOT_CONFIGURED, SECURITY_BLOCK,
  BUDGET_EXCEEDED, INVALID_REQUEST), clase `AIProviderError` con
  `recoverable`, `isRecoverableKind` y `toPublicErrorCode`.
- Fallback permitido en errores de autenticación/configuración del
  proveedor; bloqueado en seguridad y presupuesto. `BUDGET_EXCEEDED`
  preservado para T-004. Mensajes de error para logs internos sin
  secretos ni datos sensibles.
- Sin SDKs de proveedores, sin llamadas reales, sin cambios a contratos
  públicos, sin cuotas ni presupuesto implementados.
- Tests: `tests/lib/ai/types.test.ts` (2) y
  `tests/lib/ai/errors.test.ts` (5). Total: 44/44.
- Validaciones: lint ✓, typecheck ✓, tests 44/44 ✓, build ✓.

## 2026-10-09 — T-003A-2: Constructor seguro de prompts (Fase 3)

- `src/lib/ai/prompt.ts`: `buildDescriptionPrompt(request)` →
  `{ systemPrompt, userContent }`. Función pura y determinista,
  sin logging ni exposición de datos sensibles.
- System prompt en español: descripción atractiva, natural y fiel;
  prohibe inventar precios, accesorios, características, garantías,
  certificaciones, ubicaciones y condiciones; prohíbe afirmar
  certificado/verificado; emojis moderados; salida en texto plano
  con párrafos breves y sin formato.
- Etiquetas legibles en español para categoría, estado y tipo de
  precio; `userNotes` dentro de bloque delimitado tratado
  exclusivamente como datos, con delimitadores neutralizados dentro
  de las notas (defensa contra fuga de bloque e inyección).
- Soporte interno de `variant` (redacción diferente sin alterar
  hechos); contrato público sin cambios ni seguimiento de
  regeneraciones.
- Tests: `tests/lib/ai/prompt.test.ts` (11), incluyendo ejemplos de
  prompt injection. Total: 55/55.
- Sin dependencias nuevas, sin proveedores reales, sin llamadas
  externas, sin cambios en `/api/generate`, sin cuotas ni presupuesto.
- Validaciones: lint ✓, typecheck ✓, tests 55/55 ✓, build ✓.

## 2026-10-09 — T-003A-3: Módulo de configuración (Fase 3)

- `src/lib/ai/config.ts`: `getAIConfig()` → `{ enabled, globalTimeoutMs,
  providers }`. `AI_ENABLED` (default false), timeout global 25s.
- Por proveedor: `enabled`, `apiKey` (interno), `model`
  (gemini-2.5-flash / llama-3.3-70b-versatile / gpt-4o-mini),
  `priority` (1/2/3) y `timeoutMs` (15s).
- Variables de entorno: `AI_ENABLED`, `AI_GLOBAL_TIMEOUT_MS`,
  `AI_{PROVIDER}_API_KEY`, `AI_{PROVIDER}_ENABLED`,
  `AI_{PROVIDER}_MODEL`, `AI_{PROVIDER}_PRIORITY`,
  `AI_{PROVIDER}_TIMEOUT_MS`.
- `getEnabledProviders()` devuelve proveedores activos ordenados por
  prioridad sin exponer `apiKey`. Cache interna con
  `resetAIConfigCache()` para tests.
- Tests: `tests/lib/ai/config.test.ts` (16). Total: 71/71.
- Sin dependencias nuevas, sin proveedores reales, sin llamadas
  externos, sin cambios en `/api/generate`, sin cuotas ni presupuesto.
- Validaciones: lint ✓, typecheck ✓, tests 71/71 ✓.

## 2026-10-09 — T-003A-4: Adaptador Gemini (Fase 3)

- `src/lib/ai/providers/gemini.ts`: `GeminiProvider` implementa
  `IAIProvider` con fetch nativo. Usa `AI_GEMINI_API_KEY` y
  `AI_GEMINI_MODEL` del servidor.
- Construye solicitud mediante `buildDescriptionPrompt` aprobado.
  Normaliza respuesta a `{ text, tokensUsed }`.
- Maneja respuestas vacías, JSON inválido y errores HTTP:
  400 → INVALID_REQUEST, 401 → AUTH_ERROR, 403 con patrón de
  seguridad → SECURITY_BLOCK, 403 → AUTH_ERROR, 429 →
  RATE_LIMITED, 5xx → PROVIDER_ERROR.
- Respeta AbortSignal del cliente y timeout individual con
  AbortController.
- No registra API keys, prompts ni datos de productos.
- Tests: `tests/lib/ai/providers/gemini.test.ts` (14) con fetch
  simulado: éxito, errores HTTP, cancelación, respuesta vacía,
  JSON inválido, timeout y consumo de tokens. Total: 85/85.
- Contratos internos y públicos intactos. AI_ENABLED=false.
  Endpoint mock sin cambios.
- Validaciones: lint ✓, typecheck ✓, tests 85/85 ✓, build ✓.

## 2026-10-09 — T-003A-5: Adaptador Groq (Fase 3)

- `src/lib/ai/providers/groq.ts`: `GroqProvider` implementa
  `IAIProvider` con fetch nativo. Usa `AI_GROQ_API_KEY` y
  `AI_GROQ_MODEL` del servidor.
- Consume API Chat Completions de Groq
  (`https://api.groq.com/openai/v1/chat/completions`). Construye
  mensajes system/user mediante `buildDescriptionPrompt` aprobado.
- Normaliza respuesta a `{ text, tokensUsed }` desde
  `choices[0].message.content` y `usage.total_tokens`.
- Maneja respuestas vacías, JSON inválido, errores de red y HTTP:
  400 → INVALID_REQUEST, 401 → AUTH_ERROR, 403 con patrón de
  seguridad → SECURITY_BLOCK, 403 → AUTH_ERROR, 429 →
  RATE_LIMITED, 5xx → PROVIDER_ERROR.
- Respeta AbortSignal del cliente y timeout individual con
  AbortController.
- No registra API keys, prompts ni datos de productos.
- Tests: `tests/lib/ai/providers/groq.test.ts` (16) con fetch
  simulado: éxito, tokens presentes/ausentes, respuesta vacía,
  malformada, JSON inválido, errores HTTP, timeout, cancelación y
  errores de red. Total: 101/101.
- Nota: `llama-3.3-70b-versatile` está en estado "Enterprise" con
  "Contact Sales" en Groq; hay indicios de deprecación (issue
  GitHub agosto 2026). No se cambió el modelo predeterminado.
- Contratos internos y públicos intactos. AI_ENABLED=false.
  Endpoint mock sin cambios.
- Validaciones: lint ✓, typecheck ✓, tests 101/101 ✓, build ✓.

## 2026-10-09 — T-003A-6: Adaptador OpenAI (Fase 3)

- `src/lib/ai/providers/openai.ts`: `OpenAIProvider` implementa
  `IAIProvider` con fetch nativo. Usa `AI_OPENAI_API_KEY` y
  `AI_OPENAI_MODEL` del servidor.
- Consume API Chat Completions de OpenAI
  (`https://api.openai.com/v1/chat/completions`). Construye
  mensajes system/user mediante `buildDescriptionPrompt` aprobado.
- Normaliza respuesta a `{ text, tokensUsed }` desde
  `choices[0].message.content` y `usage.total_tokens`.
- Maneja respuestas vacías, JSON inválido, errores de red y HTTP:
  400 → INVALID_REQUEST, 401 → AUTH_ERROR, 403 con patrón de
  seguridad → SECURITY_BLOCK, 403 → AUTH_ERROR, 5xx →
  PROVIDER_ERROR.
- Clasificación de 429 diferenciada: rate limit temporal →
  RATE_LIMITED, cuota/facturación agotada → BUDGET_EXCEEDED,
  genérico → RATE_LIMITED. No todos los 429 son recuperables.
- Respeta AbortSignal del cliente y timeout individual con
  AbortController.
- No registra API keys, prompts, respuestas completas ni datos
  de productos.
- Tests: `tests/lib/ai/providers/openai.test.ts` (18) con fetch
  simulado: éxito, tokens presentes/ausentes, respuesta vacía,
  malformada, JSON inválido, errores HTTP, rate limit temporal vs
  cuota agotada, timeout, cancelación y errores de red.
  Total: 119/119.
- Contratos internos y públicos intactos. AI_ENABLED=false.
  Endpoint mock sin cambios.
- Validaciones: lint ✓, typecheck ✓, tests 119/119 ✓, build ✓.

## 2026-10-09 — T-003A-7: AIOrchestrator (Fase 3)

- `src/lib/ai/orchestrator.ts`: `generateWithFallback(request,
  context, options)` ejecuta proveedores según prioridad.
- Fallback solo ante errores recuperables (RATE_LIMITED,
  PROVIDER_ERROR, AUTH_ERROR, NOT_CONFIGURED). Detiene la cadena
  ante BUDGET_EXCEEDED, SECURITY_BLOCK e INVALID_REQUEST.
- Proveedores de pago deshabilitados por defecto
  (`allowPaidProviders=false`). Timeout individual y global
  (25s) compartido por toda la cadena. Respeta AbortSignal del
  cliente y detiene el fallback cuando se cancele.
- Registra metadatos técnicos seguros vía `onProviderAttempt`:
  proveedor, duración y tipo de error. Sin API keys, prompts ni
  datos de productos.
- Sin proveedores configurados → INTERNAL_ERROR. Todos fallan →
  PROVIDER_UNAVAILABLE. BUDGET_EXCEEDED preservado para T-004.
- `src/lib/ai/config.ts`: agregado `isPaid` a `AIProviderConfig`
  (T-003A-7). Contratos públicos intactos. AI_ENABLED=false.
  Endpoint mock sin cambios. Sin llamadas reales en pruebas.
- Tests: `tests/lib/ai/orchestrator.test.ts` (13) con mocks de
  proveedores: primer éxito, fallback, no configurado, pago
  bloqueado, todos fallan, error no recuperable, timeouts,
  cancelación y orden configurable. Total: 132/132.
- Validaciones: lint ✓, typecheck ✓, tests 132/132 ✓, build ✓.

## 2026-10-09 — T-003A-8: Integración AIOrchestrator con endpoint (Fase 3)

- `src/lib/ai/descriptionService.ts`: capa de servicio que conecta
  el endpoint con el AIOrchestrator. `AI_ENABLED=false` conserva
  mock exacto. Segunda protección independiente:
  `realCallsAuthorized` (flag en código, no en variables de
  entorno). Sin autorización → 503 INTERNAL_ERROR sin contactar
  proveedores. Mapea resultados del orquestador a
  IDescriptionResponse. Propaga AbortSignal.
- `src/app/api/generate/route.ts`: actualizado para usar
  `generateDescription`. Validación Zod intacta. Contratos
  públicos sin cambios.
- Tests: `tests/api/generate.test.ts` (+7 integración): mock
  conservado, AI_ENABLED=true sin autorización no realiza llamadas
  externas, validación de solicitudes inválidas, mapeo de
  respuestas, ausencia de exposición de información sensible,
  contratos públicos sin cambios. Total: 139/139.
- Contratos públicos intactos. AI_ENABLED=false. Endpoint mock
  conservado. Sin llamadas reales en ejecución normal.
- Validaciones: lint ✓, typecheck ✓, tests 139/139 ✓, build ✓.

## 2026-10-09 — T-003A-9: Pruebas de integración y seguridad (Fase 3)

- `tests/integration/security.test.ts`: 12 pruebas de integración
  y seguridad.
- Casos cubiertos: (1) AI_ENABLED=false conserva mock exacto;
  (2) AI_ENABLED=true sin autorización no realiza llamadas
  externas; (3) realCallsAuthorized inmutable desde el body;
  (4) validación previa a generación; (5) contrato
  IDescriptionResponse en éxito; (6) mapeo de errores del
  orquestador; (7) BUDGET_EXCEEDED preservado; (8) orden de
  fallback configurable; (9) proveedores de pago bloqueados;
  (10) timeouts y cancelación; (11) no exposición de API keys,
  prompts ni detalles internos; (12) sin llamadas reales en
  pruebas.
- Total: 151 pruebas (12 nuevas).
- Sin cambios en código de producción. Contratos públicos
  intactos. AI_ENABLED=false. Sin llamadas reales.
- Validaciones: lint ✓, typecheck ✓, tests 151/151 ✓, build ✓.

## 2026-10-11 — T-004-2: Cliente Supabase (Fase 4)

- `src/lib/db/supabaseClient.ts`: cliente Supabase servidor con
  `@supabase/supabase-js` 2.117.3. Variables `SUPABASE_URL` y
  `SUPABASE_SERVICE_ROLE_KEY` (nunca NEXT_PUBLIC_). Validación
  `isSupabaseConfigured()`, error controlado `SupabaseConfigError`,
  soporte de inyección para pruebas vía `setSupabaseClient()`,
  helper `callRpc()` para futuras funciones transaccionales.
- Tests: `tests/lib/db/supabaseClient.test.ts` (12). Total: 179/179.
- Sin migraciones, sin tablas, sin operaciones remotas, sin cambios
  en contratos públicos.
- Validaciones: lint ✓, typecheck ✓, tests 179/179 ✓, build ✓.

## 2026-10-11 — T-004-1: Módulo de identificación de visitante (Fase 4)

- `src/lib/visitors/visitorService.ts`: generación de visitorId
  UUID v4, validación, extracción de cookie y helper
  `getOrCreateVisitorId`.
- Cookie `visitor_id` con HttpOnly, SameSite=Lax, Secure en
  producción, Path=/, Max-Age 1 año.
- Tests: `tests/lib/visitors/visitorService.test.ts` (14).
  Total: 165/165.
- Sin dependencias nuevas, sin migraciones, sin llamadas reales,
  sin cambios en contratos públicos, sin Supabase.
- Validaciones: lint ✓, typecheck ✓, tests 165/165 ✓, build ✓.

## 2026-10-11 — T-003A-10: Documentación y cierre de arquitectura de IA (Fase 3)

- Cierre documental de T-003A. Sin cambios en código de producción.
- Adaptadores implementados y documentados: Gemini (gemini-2.5-flash),
  Groq (llama-3.3-70b-versatile), OpenAI (gpt-4o-mini).
- Llamadas reales deshabilitadas por defecto: AI_ENABLED=false
  (variable de entorno) y realCallsAuthorized=false (flag interno
  en código, no configurable por el usuario).
- Contratos públicos intactos: IDescriptionRequest/IDescriptionResponse.
- Endpoint /api/generate conserva respuesta MOCK.
- Pendiente registrado: revisión del modelo predeterminado de Groq
  (llama-3.3-70b-versatile en estado "Enterprise" con "Contact Sales";
  indicios de deprecación).
- Validaciones: lint ✓, typecheck ✓, tests 151/151 ✓, build ✓.

## 2026-10-12 — T-004-3A: Esquema PostgreSQL y migraciones (Fase 4)

- 6 migraciones SQL idempotentes en `supabase/migrations/`:
  visitor_daily_quota, quota_reservations, generation_records,
  budget_tracking, ip_rate_limits, habilitación de RLS.
- Restricciones: claves primarias, foráneas, CHECK, UNIQUE,
  índices parciales, TIMESTAMPTZ, estrategia America/Mexico_City.
- `tests/integration/schema.test.ts`: 33 pruebas estáticas de
  esquema (validación de sintaxis SQL por contenido de archivo).
- Validación real en PostgreSQL 17-alpine (Docker): 6 migraciones
  aplicadas exitosamente, 5 tablas, 20 índices, restricciones
  verificadas (CHECK, UNIQUE, FOREIGN KEY), RLS activo, roles
  anon/authenticated sin acceso.
- Corregido: índice `idx_gen_month` reemplazado por `idx_gen_created_at`
  (B-tree sobre created_at) por error IMMUTABLE en PostgreSQL 17.
- Total: 228/228.
- Validaciones: lint ✓, typecheck ✓, tests 228/228 ✓, build ✓.

## 2026-10-12 — T-004-3: Módulo de cuota diaria (Fase 4)

- `src/lib/quota/quotaService.ts`: reserveQuota, confirmQuota,
  releaseQuota, getQuotaStatus. Cuota 5/día por visitante.
  Fecha de cuota en America/Mexico_City, timestamps UTC.
- Funciones RPC PostgreSQL (`supabase/migrations/007-011`):
  reserve_quota (SELECT FOR UPDATE + límite 3 pendientes),
  confirm_quota, release_quota (decrementa con GREATEST),
  get_quota_status, expire_pending_reservations.
- Atomicidad verificada: 20 solicitudes simultáneas nunca
  superan 5 unidades de cuota ocupadas. Ciclo completo
  reserva→confirma alcanza exactamente 5.
- generations_used = generaciones confirmadas + reservas
  pendientes.
- Decisión aprobada (opción 1): máximo 3 reservas pendientes
  simultáneas; ráfaga de 20 produce 3 reservas y 17
  rate_limited.
- Idempotencia: confirmación/liberación duplicadas retornan
  already_processed sin doble efecto.
- Corrección de fechas: release_quota y
  expire_pending_reservations derivan quota_date desde
  created_at en America/Mexico_City (no usan CURRENT_DATE),
  liberando la cuota del día original aunque la operación
  ocurra después de medianoche.
- Permisos: REVOKE EXECUTE FROM PUBLIC en las 5 RPC; solo
  el servidor (owner/service_role) puede ejecutarlas.
- Fail-closed: QuotaServiceError si Supabase no responde.
- Pruebas: 16 unitarias (mocks) + 8 concurrencia reales contra
  PostgreSQL 17-alpine en Docker, incluyendo 2 regresión de
  cambio de día (creada antes de medianoche, liberada/expirada
  después).
- Total: 252/252.
- Validaciones: lint ✓, typecheck ✓, tests 252/252 ✓, build ✓.
- Pendiente: integrar en /api/generate (T-004-6).

## 2026-10-13 - T-004-4: Modulo de rate limiting por IP (Fase 4)

- src/lib/ratelimit/rateLimiter.ts: checkRateLimit, normalizeIpAddress, extractClientIp, RateLimiterError.
- RPC check_rate_limit(INET) en supabase/migrations/012_check_rate_limit.sql con ventanas de 10/min, 100/hora y 500/24h y SELECT FOR UPDATE.
- Limpieza de registros con mas de 24 horas. Retencion maxima 24h.
- Validacion de IPv4/IPv6 con net.isIP. Extraccion de IP solo con proxy confiable.
- Fail-closed mediante RateLimiterError.
- Pruebas: 11 unitarias + 2 reales de concurrencia PostgreSQL 17-alpine (20 simultaneas).
- Total: 265/265.
- Validaciones: lint, typecheck, test y build exitosos.
- Pendiente: integracion en /api/generate (T-004-6) y HMAC de IP opcional (cambio de esquema).

## 2026-10-13 - T-004-5: Modulo de control de presupuesto y costos IA (Fase 4)

- src/lib/budget/budgetService.ts: reserveBudget, confirmBudget, releaseBudget, getBudgetStatus, calculo de costos por modelo.
- Migracion supabase/migrations/013_budget_reservations.sql: budget_reservations y funciones reserve_budget, confirm_budget, release_budget, get_budget_status.
- Reserva mensual UTC con umbral de 95%. Reservas idempotentes por reservation_id.
- Confirmacion concilia gasto real o estimado; liberacion idempotente.
- Costos basados en tabla de spec: gemini/gpt-4o-mini, Groq con sus tarifas por 1M tokens; maximo por max tokens.
- Estimacion conservadora 400/200 cuando no hay tokens reportados, marcada como estimada.
- Fail-closed mediante BudgetServiceError.
- Pruebas: 13 unitarias + 2 integracion real PostgreSQL 17.
- Total: 281/281.
- Validaciones: lint, typecheck, test y build exitosos.
- Decision: se agregó budget_reservations porque budget_tracking agregado no permitia idempotencia; esquema INET no se cambio.
- Pendiente: integracion en /api/generate (T-004-6), job de limpieza y HMAC de IP (futuro).

## 2026-10-13 - Correccion de seguridad T-004-5: RLS y permisos en budget_reservations (Fase 4)

- supabase/migrations/014_secure_budget_reservations.sql: RLS habilitado, permisos revocados para anon/authenticated/PUBLIC, EXECUTE de RPC restringido.
- tests/integration/schema.test.ts: verificaciones de migraciones 14 y seguridad budget_reservations.
- tests/integration/budget-security.test.ts: prueba real PostgreSQL 17 de acceso denegado para anon/authenticated y RPC privilegiada; service_role puede operar.
- Decisiones de presupuesto documentadas en MEMORY.md (umbral 4.75, timeout post-envio conciliado, no liberar sin certeza, reserva por fallback, registro de exceso, bloqueo futuro).
- Validaciones: lint, typecheck, test y build exitosos.

## 2026-10-13 - T-004-6: pruebas focalizadas de integracion (Fase 4)

- tests/api/generate.t004-6.test.ts: 12 escenarios A, B, C, D, E, F, G, H, I, J, N, O.
- Total de pruebas: 299/299.
- Validaciones: lint, typecheck, test y build exitosos.
- Hallazgos: compensaciones implementadas; pendiente cierre autorizado.
- Decision: no comitear aun, esperar revision.

## 2026-10-13 - Reconciliacion T-004-6 (Fase 4)

- src/lib/quota/quotaService.ts: confirmQuota con reintentos acotados.
- src/lib/budget/budgetService.ts: confirmBudget con reintentos acotados.
- src/lib/ai/orchestrator.ts: consumeUnknown conservador si confirmBudget falla.
- supabase/migrations/015_reconcile_successful_quota.sql: expire_pending_reservations protege generaciones exitosas.
- supabase/migrations/016_reconcile_budget_reservations.sql: reconcile_pending_budget_reservations idempotente.
- Total: 299/299. Sin commit; espera revision.

## 2026-10-13 — T-004-6: Integracion en /api/generate

- Integrado en src/app/api/generate/route.ts y src/lib/ai/descriptionService.ts.
- Flujo con visitor ID, rate limit por IP, cuota, presupuesto, orquestador, fallback, compensaciones y registro.
- Cuota: reserva antes, liberacion si todos los proveedores fallan; confirmacion solo despues de generacion exitosa.
- Presupuesto: reserva por proveedor de pago, confirmacion con costo real/estimado; no se libera consumo desconocido.
- Reconciliacion: expiracion no decrementa reservas ligadas a generation_records.success; confirmacion idempotente post-budget; recuperacion conservadora.
- Validacion local: lint/typecheck/test/build. Resultado exacto: 299 aprobadas y 4 omitidas; no se presenta como validacion completa.
- Prueba PostgreSQL automatizada de reconciliacion en describe.skip por transporte/infraestructura local; SQL validado manualmente en PostgreSQL 17.
- Riesgo bloqueante de produccion: generacion correcta con falla de generation_records y confirmQuota puede provocar liberacion incorrecta de cuota.
- Riesgo obligatorio para T-004-7: resolucion de pruebas automaticas, proteccion persistente para resultados inciertos, concurrencia y recuperacion tras reinicio.
- Estado: implementado y committeado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-13 — T-004-7 Parte A: prueba automatizada de reconciliacion PostgreSQL

- tests/integration/reconciliation.test.ts: se elimino describe.skip; los fixtures SQL se ejecutan con docker cp + psql -f y usan CURRENT_DATE.
- Causa confirmada del skip: los comandos SQL multilinea con psql -c fallaban en el harness y la fecha de cuota fija quedo desfasada.
- 3 pruebas reales contra PostgreSQL 17-alpine: pending con exito no se libera al expirar; pending sin registro exitoso expira y libera; reconciliacion de presupuesto idempotente.
- Sin cambios de esquema ni de contratos publicos.

## 2026-10-13 — T-004-7 Parte B: proteccion persistente de resultado incierto

- supabase/migrations/017_quota_reservation_protection.sql: estado sent_uncertain en quota_reservations, RPC mark_quota_sent(UUID), confirm_quota y release_quota aceptan pending y sent_uncertain, expire_pending_reservations completa las inciertas con exito y nunca las libera. EXECUTE revocado a PUBLIC, anon y authenticated; concedido a service_role.
- src/lib/quota/quotaService.ts: markQuotaSent con 3 reintentos y QuotaServiceError (fail-closed).
- src/lib/ai/descriptionService.ts: marca la reserva como enviada antes de invocar al orquestador; si falla responde 503 sin llamar al proveedor; no libera cuota cuando el consumo es incierto.
- src/lib/ai/orchestrator.ts: propaga consumptionUnknown en los errores.
- Pruebas: 6 unitarias, 5 de integracion del ciclo sent_uncertain, 3 de concurrencia con 20 llamadas simultaneas, 5 estaticas de la migracion y 1 de API.
- Total: 322/322. Lint, typecheck y build exitosos.
- Riesgo residual: rate-limit-concurrency.test.ts puede fallar si la rafaga de 20 solicitudes cruza el limite de la ventana fija de un minuto (preexistente).
- Estado: implementado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-13 — Cierre tecnico T-004-7: correccion de la prueba intermitente de rate limiting

- Diagnostico: check_rate_limit (supabase/migrations/012_check_rate_limit.sql) NO implementa ventana movil; usa cubetas fijas alineadas con date_trunc para minuto, hora y dia. La prueba asumia que las 20 llamadas caerian en una sola cubeta de minuto.
- Correccion de la prueba: rafaga de 20 procesos psql concurrentes dentro del contenedor (script con docker cp), alineada al inicio de un minuto con 30 s de margen; aserciones apoyadas en el estado persistido (3 filas minuto/hora/dia con 10 cada una, MAX=10, SUM=30), invariantes en el tiempo y incapaces de ocultar una cubeta extra. Se conservan las aserciones estrictas 10 permitidas / 10 rechazadas.
- Pruebas nuevas: contrato de rate_limited (semilla y llamada en una sola transaccion, sin carrera de minuto) y evidencia de que las cubetas son de calendario.
- Segunda causa raiz, en los cinco harnesses de integracion: pg_isready acepta conexiones durante el servidor efimero del entrypoint de PostgreSQL, por lo que la siguiente comando fallaba con the database system is shutting down y la rafaga podia servirse contra un servidor reiniciado (17 aceptadas). Sustituido por sonda con consulta real y 3 respuestas consecutivas antes de aplicar migraciones en budget-concurrency, budget-security, quota-concurrency, rate-limit-concurrency y reconciliation.
- No se modificaron los limites de produccion (10/100/500) ni la logica SQL de check_rate_limit.
- Total: 324/324. Lint, typecheck y build exitosos. 10/10 ejecuciones completas de pnpm test en verde, ademas de 12 ejecuciones instrumentadas y 15 aisladas de la prueba de rate limit.
- Riesgo abierto: las cubetas de calendario no son ventana movil; una IP puede recibir hasta 20 solicitudes en ~1 s cruzando el cambio de minuto. Corregirlo requiere una migracion SQL autorizada.
- Estado: implementado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-13 — Documentacion de ventanas fijas y bloqueantes de produccion (pre-commit T-004-7)

- specs/features/generate-description/spec-t004.md: la seccion 10 declara explicitamente que check_rate_limit usa ventanas fijas de calendario (date_trunc) y NO ventanas moviles, con su consecuencia asumida de hasta 20 solicitudes en ~1 s al cruzar el cambio de minuto.
- Seccion 11 nueva: bloqueantes de produccion (limite de 10 por cualquier intervalo movil de 60 s pendiente de migracion autorizada; aprobacion de produccion de T-004-6/T-004-7) y pendientes (job automatico de reconciliacion de reservas; verificacion del modelo Groq).
- Seccion de restricciones renumerada de 10 a 12 para corregir la numeracion duplicada.
- No se modificaron migraciones historicas ya aplicadas (005 conserva el comentario "sliding window" inexacto; la semantica real quedo documentada en la especificacion).
- MEMORY.md: bloqueos y pendientes actualizados con los mismos puntos.
- Estado: sin cambios de codigo. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-13 — Reparacion de codificacion en archivos del proyecto

- MEMORY.md estaba doblemente codificado en UTF-8 (mojibake) y con caracteres perdidos en 4 lineas; se repararon 61 lineas.
- Mensajes al usuario corruptos en src/lib/ai/orchestrator.ts y src/lib/ai/descriptionService.ts restaurados.
- Sin cambios de comportamiento.

## 2026-10-13 — T-004-7A: rate limiting con ventana movil real

- supabase/migrations/018_sliding_window_rate_limit.sql (nueva): tabla ip_rate_limit_events con una fila por solicitud aceptada, indice (ip_address, accepted_at DESC) y RLS activo sin politicas.
- check_rate_limit(INET) reescrita con ventanas moviles (t - W, t] de 60, 3600 y 86400 segundos y limites 10/100/500; las solicitudes rechazadas no se registran.
- Serializacion por IP con pg_advisory_xact_lock(hashtextextended(ip, 0)) y reloj capturado una sola vez con clock_timestamp() despues del bloqueo.
- Contrato JSON sin cambios: rateLimiter.ts no se modifico y se agregaron pruebas que fijan el nombre de la RPC y sus parametros.
- SET search_path = public, pg_temp; EXECUTE revocado a PUBLIC, anon y authenticated y concedido a service_role.
- Migraciones 005 y 012 intactas; la tabla legada ip_rate_limits se conserva sin escritores.
- Pruebas nuevas: 9 de ventana movil (20 concurrentes = 10 aceptadas y 10 rechazadas, cruce de minuto de calendario, fronteras exactas de 60 s, limites moviles de hora y dia, counts, retry_after_seconds, expiracion a 24 h, IPs independientes) y 5 de permisos/RLS en tiempo de ejecucion; 9 estaticas de la migracion 018; 2 de contrato en rateLimiter.test.ts.
- La prueba de rafaga ya no requiere alinearse al inicio de un minuto.
- Total: 345/345. Lint, typecheck y build exitosos. 12/12 corridas completas de pnpm test en verde.
- Pendiente: la limpieza global de eventos antiguos y la reconciliacion de reservas requieren el job periodico que sigue sin implementarse.
- Estado: implementado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.
