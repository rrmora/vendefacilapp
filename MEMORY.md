# MEMORY — VendeFácil AI

## Estado actual del proyecto

Fase 3 — Integración de IA en curso (T-003A). T-003A-1,
T-003A-2, T-003A-3, T-003A-4, T-003A-5, T-003A-6, T-003A-7,
T-003A-8 y T-003A-9 completadas.
Stack: Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3 (strict),
Tailwind CSS 4.3.3, Zod 4.6.5, Vitest 5.0.3, @testing-library/react
16.3.3, happy-dom 20.14.5, pnpm 12.4.2, Node.js 24.21.0.

## Fase activa

T-003A — Arquitectura de proveedores de IA. T-003A-2 completada
y validada. T-003A-3 (módulo de configuración) en curso.

## Última tarea completada

T-003A-9 — Pruebas de integración y seguridad (2026-10-09).

## Últimos cambios

- `tests/integration/security.test.ts`: 12 pruebas de integración
  y seguridad cubriendo: mock conservado, bloqueo de llamadas
  externas, inmutabilidad de realCallsAuthorized, validación
  previa, contrato de respuesta, mapeo de errores,
  BUDGET_EXCEEDED preservado, orden de fallback, bloqueo de
  proveedores de pago, timeouts/cancelación, no exposición de
  información sensible y ausencia de llamadas reales.
- Total: 151 pruebas (12 nuevas).
- MEMORY/CHANGELOG actualizados.

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

T-003A-3 — Módulo de configuración (`src/lib/ai/config.ts`):
AI_ENABLED (default false), prioridad, timeouts, claves y modelos
por proveedor. Requiere aprobación.
