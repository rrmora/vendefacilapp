# MEMORY — VendeFácil AI

## Estado actual del proyecto

Fase 4 — Cuotas, presupuesto y protección contra abuso (T-004).
T-004-1, T-004-2 y T-004-3A completadas. T-004-3 a T-004-8 pendientes.
Stack: Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3 (strict),
Tailwind CSS 4.3.3, Zod 4.6.5, Vitest 5.0.3, @testing-library/react
16.3.3, happy-dom 20.14.5, pnpm 12.4.2, Node.js 24.21.0.

## Fase activa

T-004-3 — Módulo de cuota diaria (pendiente de aprobación).

## Última tarea completada

T-004-3A — Esquema PostgreSQL y migraciones (2026-10-12).

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
- Las migraciones NO se han ejecutado contra PostgreSQL real ni
  Supabase. Solo validación estática de contenido.
- Total: 228/228 (195 unitarias/integración + 33 estáticas de esquema).

## Decisiones arquitectónicas

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

Ninguno.

## Siguiente tarea propuesta

T-004-3 — Módulo de cuota diaria (`src/lib/quota/quotaService.ts`).
Requiere aprobación explícita del usuario.
