# plan-generate-description

> Source: specs/features/generate-description/plan.md (snapshot del repositorio vende-facil-app)
> Collected: 2026-10-27
> Published: Unknown

# Plan técnico — Generar descripción (Fase 1: Scaffolding)

## 1. Arquitectura

- **API Layer:** Route Handler `src/app/api/generate/route.ts` (POST).
  Valida con Zod y responde según el contrato público. Implementación MOCK.
- **Contratos:** `src/types/description.ts` (públicos, aprobados en §9 del
  master prompt).
- **Tests:** Vitest en `tests/`, importación relativa del handler (sin alias
  para evitar configuración extra en esta fase).

## 2. Componentes y archivos afectados

- `src/types/description.ts` (nuevo).
- `src/app/api/generate/route.ts` (nuevo).
- `tests/api/generate.test.ts` (nuevo).
- `src/app/page.tsx` (placeholder en español; formulario real en Fase 2).
- `src/app/layout.tsx` (metadata en español, `lang="es"`).
- `package.json` (scripts `test` y `typecheck`).
- Contexto: `CONSTITUTION.md`, `AGENTS.md`, `MEMORY.md`, `CHANGELOG.md`,
  `.env.example`; `specs/`.

## 3. Dependencias

- `zod` 4.6.5 (runtime): validación server-side.
- `vitest` 5.0.3 (dev): pruebas del endpoint.
- No se instalan en Fase 1: SDKs de IA, Supabase, pagos, PWA.

## 4. Riesgos

- **Bajo:** Next.js 16 tiene cambios respecto a versiones anteriores; se
  verifican guías en `node_modules/next/dist/docs/` antes de código nuevo.
- **Bajo:** TypeScript 5.9.3 elegido sobre 7.0.2 por compatibilidad de
  ecosistema verificada.
- **Medio:** Tailwind v4 vía Turbopack (sin tailwind.config); convenciones
  distintas a v3.

## 5. Estrategia de pruebas

- Unitarias (Vitest): validación del endpoint, casos éxito/error/límite,
  método no permitido.
- `pnpm typecheck` (tsc --noEmit, strict).
- `pnpm lint` (ESLint 9 + eslint-config-next).
- `pnpm build` (Next.js production build).
- Playwright y E2E: Fase 5.

## 6. Decisiones

- Respuesta MOCK determinista, construida solo con datos de entrada, con
  prefijo `[MOCK]` visible.
- `tokensUsed: null` en el mock (no hay consumo real).
- Sin logs de prompts; sin persistencia en Fase 1.

## 7. Decisión arquitectónica T-004 (2026-10-09)

El MVP continuará sin autenticación obligatoria. Para T-004 (cuotas y
protección contra abuso):

1. Identificación anónima mediante cookie segura HttpOnly, SameSite=Lax y
   Secure en producción, con identificador aleatorio generado por el servidor.
2. Cuota inicial de 5 generaciones exitosas por visitante por día, incluyendo
   regeneraciones.
3. Persistencia del contador en el servidor, no en localStorage.
4. Reservas atómicas para evitar superar cuotas mediante solicitudes
   concurrentes.
5. Liberación de reservas cuando la generación no tenga éxito.
6. Rate limiting adicional por IP, con límites independientes de la cuota
   diaria.
7. Controles globales de concurrencia y presupuesto de proveedores de pago.
8. Registro de consumo facturable incluso cuando una solicitud falle después
   de consumir tokens.
9. Sin fingerprinting invasivo.
10. Sin registro obligatorio durante el MVP.

Se documenta expresamente que cambiar de navegador, dispositivo o borrar
cookies puede permitir obtener una nueva identidad anónima. El objetivo es
reducir el abuso, no prometer impedirlo completamente.

Estos cambios NO se implementan durante T-003A. Se incorporan a la
especificación de T-004 y requieren un plan técnico para aprobación.

## 8. Cierre de Fase 3 — T-003A (2026-10-11)

### 8.1 Estado final

- Arquitectura de IA completada y documentada.
- Adaptadores: Gemini, Groq, OpenAI implementados con fetch nativo.
- Llamadas reales deshabilitadas: AI_ENABLED=false (default),
  AI_REAL_CALLS_ENABLED=false (variable privada del servidor).
- 151 pruebas, lint/typecheck/build exitosos.
- Contratos públicos intactos.

### 8.2 Decisiones pendientes para T-004

1. Revisión del modelo predeterminado de Groq (llama-3.3-70b-versatile
   en estado "Enterprise"; indicios de deprecación).
2. Definición de visitante anónimo (cookie HttpOnly, SameSite=Lax, Secure).
3. Cuota inicial: 5 generaciones exitosas por visitante por día.
4. Presupuesto mensual inicial: US$5.
5. Rate limiting por IP con límites independientes de la cuota.
6. Reservas atómicas contra concurrencia.
7. Registro de consumo facturable incluso en fallos post-consumo.

### 8.3 Requisito

T-004 no comienza sin aprobación explícita del usuario.
