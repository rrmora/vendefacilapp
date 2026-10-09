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

## T-004 — Adaptadores y orquestador de IA (Fase 3)

- **Objetivo:** interfaz `IAIProvider`, adaptadores Gemini/Groq/OpenAI,
  orquestador con timeout y fallback configurable, prompts, normalización.
- **Dependencias:** T-001 (contratos). Requiere aprobación aparte de
  instalación de SDKs.
- **Validaciones:** unitarias con mocks de red, typecheck, lint, build.

## T-005 — Cuotas, rate limiting y presupuesto (Fase 4)

- **Objetivo:** contadores de generaciones (Supabase), cuota diaria configurable
  (inicial 5/día), reservas atómicas, rate limiting, presupuesto mensual
  (inicial US$5) con control de concurrencia, protección contra abuso.
- **Dependencias:** T-004. Requiere aprobar definición de visitante, zona
  horaria y reinicio de cuota antes de implementar.
- **Validaciones:** unitarias, pruebas de concurrencia, integración, build.
- **Decisión arquitectónica (2026-10-09):** sin autenticación obligatoria
  en el MVP. Identificación anónima mediante cookie segura HttpOnly,
  SameSite=Lax y Secure en producción, con ID aleatorio generado por el
  servidor. Contador de cuota en servidor (no localStorage). Reservas
  atómicas para evitar superar cuotas con solicitudes concurrentes;
  liberación cuando la generación no tiene éxito. Rate limiting adicional
  por IP con límites independientes de la cuota diaria. Controles globales
  de concurrencia y presupuesto de proveedores de pago. Registro de
  consumo facturable incluso cuando una solicitud falle después de
  consumir tokens. Sin fingerprinting invasivo. Sin registro obligatorio.
  Se documenta expresamente que cambiar de navegador, dispositivo o borrar
  cookies puede permitir obtener una nueva identidad anónima; el objetivo
  es reducir el abuso, no prometer impedirlo completamente.

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
