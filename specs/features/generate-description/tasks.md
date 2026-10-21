# Tasks — Generar descripción

Formato: identificador, objetivo, archivos afectados, dependencias, criterios de
aceptación, validaciones.

## T-001 — Scaffolding (Fase 1) ✅ en curso/aprobada

- **Objetivo:** inicializar `vendefacil-pwa`, contratos, API mock con validación
  Zod, contexto persistente, especificaciones, pruebas básicas.
- **Archivos:** `src/types/description.ts`, `src/app/api/generate/route.ts`,
  `tests/api/generate.test.ts`, `src/app/page.tsx`, `src/app/layout.tsx`,
  `package.json`, `CONSTITUTION.md`, `AGENTS.md`, `MEMORY.md`, `CHANGELOG.md`,
  `.env.example`, `specs/**`.
- **Dependencias:** ninguna (proyecto vacío).
- **Criterios de aceptación:** contrato público verbatim; endpoint MOCK válido y
  con validación; pruebas pasan; lint/typecheck/build pasan.
- **Validaciones:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **Estado:** aprobada por el usuario (2026-10-09).

## T-002 — Formulario mobile-first de cuatro campos (Fase 2)

- **Objetivo:** UI del formulario (categoría, estado, textarea con contador,
  checkbox negociable), validaciones cliente, estados de carga/error.
- **Dependencias:** T-001.
- **Criterios:** exactamente cuatro campos; mobile-first; accesible; español.
- **Validaciones:** lint, typecheck, unitarias de componentes, build.

## T-003 — Resultado, copiar y regenerar con MOCK (Fase 2)

- **Objetivo:** mostrar descripción, botón Copiar (portapapeles), botón
  Regenerar contra el mock.
- **Dependencias:** T-002.
- **Validaciones:** lint, typecheck, unitarias, build, E2E básico.

## T-003A — Arquitectura de proveedores de IA (Fase 3) ✅ completada

- **Objetivo:** interfaz `IAIProvider`, adaptadores Gemini/Groq/OpenAI,
  orquestador con timeout y fallback configurable, prompts, normalización.
- **Dependencias:** T-001 (contratos).
- **Validaciones:** unitarias con mocks de red, typecheck, lint, build.
- **Estado:** completada (2026-10-11). Tareas T-003A-1 a T-003A-10.
- **Adaptadores:** Gemini (gemini-2.5-flash), Groq (llama-3.3-70b-versatile),
  OpenAI (gpt-4o-mini). Llamadas reales deshabilitadas.
- **Protecciones:** AI_ENABLED=false, realCallsAuthorized=false.
- **Contratos públicos:** intactos.
- **Pendiente:** revisión modelo predeterminado Groq.

## T-004 — Cuotas, rate limiting y presupuesto (Fase 4)

- **Objetivo:** contadores de generaciones (Supabase), cuota diaria configurable
  (inicial 5/día), reservas atómicas, rate limiting, presupuesto mensual
  (inicial US$5) con control de concurrencia, protección contra abuso.
- **Dependencias:** T-003A. Requiere aprobación explícita.
- **Validaciones:** unitarias, pruebas de concurrencia, integración, build.
- **Subtareas:**
  - T-004-1: Módulo de identificación de visitante ✅
  - T-004-2: Cliente Supabase ✅
  - T-004-3A: Esquema PostgreSQL y migraciones ✅
  - T-004-3: Módulo de cuota diaria ✅
  - T-004-4: Módulo de rate limiting ✅
  - T-004-5: Módulo de presupuesto ✅
  - T-004-6: Integración en descriptionService ✅ (local, pendiente de aprobación)
  - T-004-7: Pruebas de integración y concurrencia ✅ (local, pendiente de aprobación)
  - T-004-7A: Rate limiting con ventana móvil real ✅ (local, pendiente de aprobación)
  - T-004-8: Mantenimiento automático y reconciliación
    - T-004-8.1: Corrección de expiración de cuota ✅ (local, pendiente de aprobación)
    - T-004-8.2: Corrección de reconciliación de presupuesto ✅ (local, pendiente de aprobación)
    - T-004-8.2b: `completed_at` con `clock_timestamp()` en las RPC de cuota ✅ (local, pendiente de aprobación)
    - T-004-8.3: Limpieza global de eventos de rate limit ✅ (commits locales 844784d y 1708ede; push y aprobación de producción pendientes)
    - T-004-8.4: Tabla de auditoría del mantenimiento ✅ (commit local e79dc86; 412/412; push y aprobación de producción pendientes)
    - T-004-8.5: `run_maintenance` y limpieza con estado ✅ (local, sin commit; 434/434; aprobación de commit pendiente)
    - T-004-8.5b: Privilegios mínimos de `service_role` (migración 026) ✅ (local, sin commit; aprobación de commit pendiente)
    - T-004-8.6-8.7: endpoint y documentación (pendiente)
    - T-004-8.8: Programación real (pg_cron o Vercel Cron) — bloqueada: requiere decidir despliegue
  - Cierre de fase 4: documentación y validación final (pendiente)

## T-005 — (Eliminado — duplicado de T-004)

Fusionado con T-004 para mantener coherencia con el plan SDD.

## T-006 — PWA (Fase 5)

- **Objetivo:** manifest, iconos, service worker (evaluar Serwist), estrategias
  de caché, estado offline, instalación.
- **Dependencias:** T-003.
- **Validaciones:** Lighthouse, Playwright E2E, build.

## T-007 — Preparación comercial (Fase 6)

- **Objetivo:** observabilidad, CI con GitHub Actions, revisión de seguridad,
  selección de hosting, despliegue del MVP.
- **Dependencias:** T-005, T-006.
- **Nota:** despliegue requiere autorización explícita.

**Regla:** ninguna tarea comienza sin aprobación explícita del usuario.
