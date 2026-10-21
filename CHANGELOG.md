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

## 2026-10-16 — T-004-8.1: correccion de expiracion de cuota por lote

- supabase/migrations/019_fix_quota_expiration.sql (nueva; 001-018 intactas): replace de public.expire_pending_reservations() conservando firma sin parametros y retorno INTEGER.
- Causa raiz: el ajuste de cuota usaba UPDATE visitor_daily_quota ... FROM expired, y en PostgreSQL solo se aplica una actualizacion cuando varias filas origen coinciden con la misma fila destino; un lote de N reservas vencidas del mismo visitante y fecha liberaba una sola unidad.
- Correccion: se agrupan las reservas expiradas por (visitor_id, quota_date) y se resta el conteo con GREATEST(..., 0).
- Sin cambios de semantica: sent_uncertain nunca se libera automaticamente, las reservas pending o sent_uncertain con generation_records.success = TRUE se completan sin decrementar cuota y la quota_date se deriva de created_at en America/Mexico_City.
- Se anadio SET search_path = public, pg_temp; EXECUTE revocado a PUBLIC, anon y authenticated y concedido a service_role.
- Reproduccion en PostgreSQL 17: 3 reservas vencidas del mismo visitante y dia dejan generations_used en 2 sin la migracion y en 0 con ella.
- Pruebas nuevas: liberacion de una unidad por reserva, agrupacion por visitante y por fecha, ejecucion repetida sin doble decremento, concurrencia entre expiracion y confirmacion y permisos/RLS en runtime; ademas 4 pruebas estaticas de la migracion.
- Correccion de pruebas existentes: reconciliation.test.ts sembraba visitor_daily_quota con CURRENT_DATE (fecha UTC) mientras las funciones derivan la fecha en America/Mexico_City; entre 00:00 y 06:00 UTC las pruebas fallaban sin que hubiera defecto de codigo. Ahora usan (NOW() AT TIME ZONE 'America/Mexico_City')::DATE.
- Total: 354/354. Lint, typecheck y build exitosos. 10/10 corridas completas de pnpm test en verde.
- Pendiente: T-004-8.2 (mismo defecto en reconcile_pending_budget_reservations) sigue sin autorizar.
- Estado: implementado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-16 — T-004-8.2: correccion de reconciliacion de presupuesto

- supabase/migrations/020_fix_budget_reconciliation.sql (nueva; 001-019 intactas): replace de public.reconcile_pending_budget_reservations() conservando firma, parametro p_max_age (15 min por defecto) y retorno INTEGER.
- Causa raiz: la consolidacion usaba UPDATE budget_tracking ... FROM stale y en PostgreSQL solo se aplica una actualizacion cuando varias filas origen coinciden con la misma fila destino; con varias reservas vencidas del mismo mes el gasto quedaba subcontado y reserved_usd conservaba el monto de la reserva si confirmada.
- Correccion: una sola sentencia marca como confirmed las reservas reserved mas antiguas que p_max_age y ajusta budget_tracking agrupando por budget_month.
- Mejoras de consistencia: la transicion de estado y el ajuste de budget_tracking ocurren en la misma sentencia, eliminando la ventana entre ambos pasos; el filtro status = 'reserved' evita que la conciliacion pise una reserva ya procesada por confirm_budget o release_budget.
- Politica conservadora sin cambios: actual_cost_usd = reserved_cost_usd y cost_estimated = TRUE.
- Se anadio SET search_path = public, pg_temp; EXECUTE revocado a PUBLIC, anon y authenticated y concedido a service_role.
- Reproduccion en PostgreSQL 17: 3 reservas vencidas (1.0 + 2.0 + 0.5) del mismo mes dejan spent_usd=1.0 y reserved_usd=2.0 sin la migracion, y spent_usd=3.5 y reserved_usd=0.0 con ella.
- Pruebas nuevas: suma exacta por periodo, periodos distintos, reservas no elegibles intactas, dos conciliaciones simultaneas, concurrencia con confirm_budget y con release_budget, permisos/RLS en runtime y 4 pruebas estaticas de la migracion.
- Correccion de pruebas: los fixtures de presupuesto restablecen ahora spent_usd y reserved_usd con ON CONFLICT DO UPDATE para que las sumas sean deterministas entre pruebas.
- Aislamiento: los fixtures que invocan la funcion global expire_pending_reservations borran generation_records y quota_reservations antes de sembrar, y las pruebas de sent_uncertain ejecutan siembra, expiracion y lectura en una sola transaccion.
- Hallazgo: las RPC de cuota (011/015/017) escriben completed_at con NOW(), que es el inicio de la transaccion; una transaccion larga que actualiza filas creadas por otras transiciones puede escribir un completed_at anterior al created_at y violar chk_completed_after_created. Reproducido en PostgreSQL 17. El proceso programado de T-004-8 ejecuta sus tareas en una sola transaccion, por lo que es un riesgo real; la correccion propuesta (usar clock_timestamp) NO se aplica sin autorizacion.
- Total: 365/365. Lint, typecheck y build exitosos.
- Pendiente en ese momento: T-004-8.4 en adelante seguia sin autorizar.
- Estado: implementado y committeado localmente, no aprobado para produccion. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-20 — T-004-8.2b: correccion de timestamps de transicion de cuota

- supabase/migrations/021_fix_quota_transition_timestamps.sql (nueva; 001-020 intactas): replace de public.confirm_quota(UUID), public.release_quota(UUID) y public.expire_pending_reservations(). Firmas, retornos, estados, idempotencia y proteccion de sent_uncertain conservados.
- Causa raiz: NOW() es el inicio de la transaccion, no el instante de la instruccion. Una transaccion iniciada antes de la creacion de una reserva podia escribir completed_at anterior a created_at y violar chk_completed_after_created. En expire_pending_reservations, NOW() tambien impedia ver como vencidas las reservas que expiraban durante la transaccion.
- Correccion: completed_at = GREATEST(clock_timestamp(), created_at) en confirm_quota y release_quota; en expire_pending_reservations se captura v_now := clock_timestamp() una sola vez y se usa para la elegibilidad (expires_at < v_now) y para completed_at = GREATEST(v_now, created_at). updated_at de visitor_daily_quota usa el reloj de ejecucion.
- El GREATEST acota completed_at y garantiza la restriccion incluso si el reloj de pared retrocede. Durante la validacion se observo una regresion de reloj del contenedor (clock_timestamp() anterior a created_at) que este limite inferior neutraliza.
- No se modifico mark_quota_sent (no escribe timestamps) ni NOW() en created_at/expires_at de reserve_quota, donde el instante consistente de la transaccion es intencional. La migracion 020 y su reconciliacion de presupuesto no se tocaron.
- Se conservan SET search_path = public, pg_temp en las tres funciones y EXECUTE revocado a PUBLIC, anon y authenticated, concedido a service_role.
- Reproduccion en PostgreSQL 17 con 001-020: transaccion iniciada antes de insertar la reserva y confirmacion posterior -> ERROR new row violates check constraint chk_completed_after_created. Con 021: confirmacion completed sin error y completed_at >= created_at. La expiracion dentro de una transaccion larga devolvia 0 sin 021 y expira el lote con 021.
- Pruebas nuevas: confirmacion y liberacion en transacciones iniciadas antes de la reserva, expiracion de tres reservas en una transaccion larga, concurrencia entre confirmacion/liberacion/expiracion, timestamps estables en llamadas idempotentes, regresion de reloj simulada con created_at futuro, permisos RPC y RLS, y 7 pruebas estaticas de la migracion 021.
- Total: 379/379. Lint, typecheck y build exitosos. 10/10 corridas completas de pnpm test en verde.
- Sin cambios en src/lib/** ni en contratos publicos. AI_ENABLED=false y realCallsAuthorized=false.
- Estado: implementado y committeado localmente, no aprobado para produccion. Sin push. AI_ENABLED=false y realCallsAuthorized=false.

## 2026-10-20 — T-004-8.3: limpieza global de eventos de rate limit

- supabase/migrations/022_cleanup_rate_limit_events.sql (nueva; 001-021 intactas): funcion public.cleanup_rate_limit_events(p_retention INTERVAL DEFAULT INTERVAL '25 hours', p_batch_size INTEGER DEFAULT 1000) RETURNS INTEGER.
- Causa raiz: check_rate_limit solo elimina los eventos vencidos de la IP que vuelve a solicitar; las IPs que no regresan dejaban crecer ip_rate_limit_events sin limite.
- Retencion minima de 25 horas: la ventana maxima es 24 horas y se conserva 1 hora de margen para desfases de reloj. Una retencion menor lanza excepcion para no borrar eventos que check_rate_limit aun necesita.
- Borrado por lotes: cada DELETE procesa hasta p_batch_size filas con FOR UPDATE SKIP LOCKED; el bucle continua hasta que no quedan elegibles y retorna el total eliminado. La funcion se ejecuta en una sola transaccion RPC; el lote acota trabajo y bloqueos por sentencia, no el total de la transaccion. Un borrado multi-transaccion requeriria un procedimiento con COMMIT o el scheduler de T-004-8.8, fuera de alcance.
- Concurrencia: pg_try_advisory_xact_lock serializa las limpiezas globales; si otra esta activa, la llamada retorna 0 sin duplicar trabajo. SKIP LOCKED evita esperar por filas bloqueadas por check_rate_limit u otra limpieza.
- Indice nuevo idx_ip_rate_events_accepted_at_id (accepted_at, id) para el barrido global; se conserva idx_ip_rate_events (ip_address, accepted_at DESC).
- No se modifico check_rate_limit: limites, ventanas, respuesta JSON y limpieza por IP permanecen intactos.
- RLS activo sin politicas; EXECUTE revocado a PUBLIC, anon y authenticated, concedido a service_role; SET search_path = public, pg_temp.
- Pruebas nuevas: 6 de integracion (retencion de 25/24/23 horas, idempotencia, 2500 eventos con lotes de 100, concurrencia con check_rate_limit, dos limpiezas simultaneas con advisory lock, RLS y permisos) y 6 estaticas de la migracion 022. Total tras la auditoria: 391/391.
- Concurrencia de dos limpiezas: prueba determinista en PostgreSQL 17 que mantiene la primera llamada activa con un gate transaccional, verifica que la segunda retorna 0 con el advisory lock retenido y que la primera elimina exactamente los eventos sembrados.
- Robustez de pruebas: se ampliaron los margenes de expiracion de los fixtures de reconciliation.test.ts (de 1-2 minutos a 5-10 minutos) para tolerar regresiones del reloj del contenedor. No cambia la logica de produccion.
- Lint, typecheck y build exitosos. La validacion previa registro 10/10 corridas completas; la auditoria actual ejecuto una corrida completa (391/391).
- Sin cambios en src/lib/** ni en contratos publicos. AI_ENABLED=false y realCallsAuthorized=false.
- Estado: commits locales 844784d (390/390) y 1708ede (auditoria, 391/391). Sin push. No aprobado para produccion. La programacion periodica sigue pendiente (T-004-8.8).

## 2026-10-20 — T-004-8.4: tabla de auditoria del mantenimiento

- supabase/migrations/023_maintenance_runs.sql (nueva; 001-022 intactas): tabla public.maintenance_runs para registrar ejecuciones futuras de run_maintenance. No crea la funcion, endpoints ni schedulers.
- La especificacion no define campos explicitos. El diseno cubre las tres tareas implementadas: expired_quota_reservations, reconciled_budget_reservations y deleted_rate_limit_events, ademas de error_details por tarea.
- Columnas: id BIGSERIAL, started_at TIMESTAMPTZ DEFAULT clock_timestamp(), finished_at nullable, status VARCHAR(20) DEFAULT 'running' (running, success, partial, failed), contadores INTEGER >= 0, error_details JSONB (objeto, '{}' por defecto) y duration_ms BIGINT GENERATED STORED.
- duration_ms se deriva de finished_at - started_at en milisegundos y es NULL mientras la ejecucion esta running; se actualiza al completar.
- Restricciones: finished_at >= started_at; (status = 'running') = (finished_at IS NULL); partial y failed exigen error_details no vacio.
- Indices: idx_maintenance_runs_started_at (started_at DESC) e idx_maintenance_runs_running parcial WHERE status = 'running'.
- RLS activo sin politicas; tabla y secuencia revocadas a PUBLIC, anon y authenticated; service_role recibe exactamente SELECT, INSERT, UPDATE y USAGE, SELECT sobre la secuencia, sin DELETE ni UPDATE de secuencia. La transicion de running a terminal usa UPDATE; no se anadio trigger de inmutabilidad porque bloquearia esa transicion.
- Pruebas nuevas: 13 de integracion en PostgreSQL 17 (esquema/defaults, running sin duracion, duracion de 2500 ms y 1500 ms, estados invalidos, coherencia status/fin, orden temporal, contadores negativos, error_details, RLS, denegacion a anon/authenticated, acceso de service_role, privilegios efectivos de tabla y secuencia, actualizacion de running a terminal, denegacion de DELETE a service_role y ausencia de run_maintenance) y 8 estaticas de la migracion 023. Total: 412/412.
- Sin cambios en src/**, contratos publicos ni migraciones historicas. AI_ENABLED=false y realCallsAuthorized=false.
- Estado: commit local e79dc86. Sin push. Aprobacion de produccion pendiente.

## 2026-10-21 — T-004-8.5: run_maintenance y limpieza con estado

- supabase/migrations/024_cleanup_rate_limit_events_status.sql (nueva; 001-023 intactas): extrae la logica comun a public.cleanup_rate_limit_events_core, define public.cleanup_rate_limit_events_status y conserva public.cleanup_rate_limit_events con firma, retorno INTEGER, validaciones y semantica.
- Causa raiz: cleanup_rate_limit_events retornaba INTEGER 0 tanto cuando no habia filas elegibles como cuando otra limpieza mantenia el advisory lock. run_maintenance no podia distinguir una tarea omitida por concurrencia de una tarea sin trabajo.
- cleanup_rate_limit_events_core adquiere pg_try_advisory_xact_lock una sola vez y retorna JSONB: {"status":"completed","deleted":N} o {"status":"already_running","deleted":0}. El wrapper publico conserva el retorno INTEGER y la variante status expone el diagnostico.
- supabase/migrations/025_run_maintenance.sql (nueva): funcion public.run_maintenance() RETURNS JSONB, SECURITY INVOKER, sin parametros. Coordina expire_pending_reservations(), reconcile_pending_budget_reservations() y cleanup_rate_limit_events_status() en ese orden.
- Concurrencia: pg_try_advisory_xact_lock(hashtextextended('public.run_maintenance', 0)). Si el lock global esta ocupado retorna exactamente {"run_id":null,"status":"already_running"} sin insertar auditoria.
- Transaccionalidad: sin commits parciales y sin PROCEDURE. Inserta una fila running, ejecuta cada tarea en su propio bloque EXCEPTION (la subtransaccion fallida se revierte y las demas continuan) y actualiza la fila al terminar. Si la transaccion completa se revierte, la auditoria tambien se revierte.
- Limpieza omitida: si cleanup_rate_limit_events_status retorna already_running, la tarea cuenta como fallida/omitida, deleted_rate_limit_events no se incrementa y error_details registra status already_running.
- Estados: success con 0 tareas fallidas, partial con 1 o 2, failed con 3. finished_at = GREATEST(clock_timestamp(), started_at); duration_ms se deriva de la columna generada.
- Errores: GET STACKED DIAGNOSTICS captura RETURNED_SQLSTATE y MESSAGE_TEXT por tarea. WHEN OTHERS no captura QUERY_CANCELED ni ASSERT_FAILURE: un timeout o una cancelacion abortan la transaccion completa y no dejan auditoria. No se guardan secretos ni datos personales.
- Hallazgo de privilegios: en un PostgreSQL limpio con 001-025, service_role tiene EXECUTE en las tres tareas, pero carece de privilegios de tabla sobre visitor_daily_quota, quota_reservations, generation_records y budget_tracking. Con SECURITY INVOKER, run_maintenance ejecutado como service_role registra partial (expire y reconcile fallan con SQLSTATE 42501, cleanup se completa). Se mantiene SECURITY INVOKER sin elevar privilegios; se documenta que el ejecutor necesita los grants de tareas y de maintenance_runs.
- Alcance respetado: no se modificaron las migraciones historicas 001-023, src/**, contratos publicos ni endpoints. No se agrego scheduler.
- Pruebas nuevas: 10 de integracion en PostgreSQL 17 (run_maintenance success con contadores y actualizacion de cuota, idempotencia, duration/GREATEST, already_running global sin auditoria, partial por limpieza concurrente, failed con SQLSTATE en las tres tareas, partial por falta de grants de service_role, cleanup_rate_limit_events_status completed vs already_running, contrato INTEGER, validaciones y permisos RPC) y 12 estaticas de las migraciones 024/025. Total: 434/434.
- Lint, typecheck y build exitosos. AI_ENABLED=false y realCallsAuthorized=false.
- Estado: implementado y validado localmente, sin commit y sin push. Aprobacion de commit pendiente.

## 2026-10-21 — T-004-8.5b: privilegios minimos de service_role (Plan A)

- supabase/migrations/026_minimum_privileges.sql (nueva; 001-025 intactas): corrige el hallazgo de privilegios de T-004-8.5 sin elevar privilegios. No redefine funciones ni desactiva RLS.
- Auditoria: en PostgreSQL 17 limpio (001-025) service_role carecia de privilegios de tabla en visitor_daily_quota, quota_reservations, generation_records y budget_tracking, por lo que run_maintenance terminaba en partial (SQLSTATE 42501 en expire_pending_reservations y reconcile_pending_budget_reservations). Ademas, en un entorno con los defaults de Supabase, anon y authenticated reciben ALL (SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER) sobre esas tablas y secuencias, y reserve_quota/get_quota_status quedaban ejecutables por clientes porque 007/010 solo revocaban PUBLIC.
- Decision: conceder a service_role los privilegios minimos verificados (no GRANT ALL) y revocar PUBLIC, anon y authenticated de forma dirigida sobre las tablas y secuencias afectadas, mas restringir EXECUTE de las 16 RPC a service_role.
- Grants a service_role: visitor_daily_quota SELECT+INSERT+UPDATE, quota_reservations SELECT+INSERT+UPDATE, generation_records SELECT+INSERT, budget_tracking SELECT+INSERT+UPDATE; USAGE en visitor_daily_quota_id_seq, quota_reservations_id_seq, generation_records_id_seq, budget_tracking_id_seq, budget_reservations_id_seq e ip_rate_limit_events_id_seq.
- EXECUTE: se revoca de PUBLIC, anon y authenticated y se concede a service_role en reserve_quota, confirm_quota, release_quota, get_quota_status, mark_quota_sent, expire_pending_reservations, reserve_budget, confirm_budget, release_budget, get_budget_status, check_rate_limit, reconcile_pending_budget_reservations, cleanup_rate_limit_events, cleanup_rate_limit_events_core, cleanup_rate_limit_events_status y run_maintenance.
- Normalizacion de service_role: se revocan DELETE/TRUNCATE/REFERENCES/TRIGGER en las cuatro tablas, UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER en generation_records, DELETE/TRUNCATE/REFERENCES/TRIGGER en budget_reservations, TRUNCATE/REFERENCES/TRIGGER en ip_rate_limit_events y SELECT/UPDATE en las seis secuencias.
- Hallazgo corregido durante la validacion: revocar UPDATE en ip_rate_limit_events rompe cleanup_rate_limit_events porque usa FOR UPDATE SKIP LOCKED; la migracion conserva UPDATE en esa tabla.
- Alcance respetado: se mantiene SECURITY INVOKER en run_maintenance, no se usa SECURITY DEFINER, no se crea rol propietario nuevo, no se modifican las migraciones 001-025, no se concede GRANT ALL a service_role y se preserva RLS sin politicas.
- Pruebas nuevas: 12 de integracion en tests/integration/privileges.test.ts sobre PostgreSQL 17 con los defaults de Supabase simulados (rol sonda vf_public_probe para medir privilegios efectivos heredados de PUBLIC): over-grant antes de 026, correccion tras 026, ausencia de privilegios de tabla y secuencia para anon/authenticated/PUBLIC, privilegios minimos de service_role, EXECUTE restringido de las 16 RPC, RLS activa sin politicas, flujos legitimos del backend, run_maintenance success, y denegacion a anon/authenticated de run_maintenance, reserve_quota, INSERT y TRUNCATE.
- Pruebas actualizadas: tests/integration/run-maintenance.test.ts ahora espera success (antes partial) cuando ejecuta service_role con los grants de 026; tests/integration/schema.test.ts pasa a 26 migraciones y agrega el bloque estatico de la 026.
- Lint, typecheck y build exitosos. AI_ENABLED=false y realCallsAuthorized=false.
- Estado: implementado y validado localmente, sin commit y sin push. Aprobacion de commit pendiente.
