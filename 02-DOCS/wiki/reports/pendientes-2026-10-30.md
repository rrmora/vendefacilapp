---
type: report
title: Pendientes de trabajo
description: Qué queda por hacer en VendeFácil AI, verificado contra el repositorio el 2026-10-30 y contrastado con la hoja de ruta del PRD.
resource: "repo @ 78797cd (chore/rsc-harness)"
tags: [reporte, pendientes, roadmap, calidad, operaciones]
timestamp: 2026-10-30T12:30:00-06:00
aliases: [pendientes-2026-10-30]
topic: operaciones
status: draft
sources: ["[Estado y hoja de ruta](../producto/estado-y-hoja-de-ruta.md)", "[Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md)", "specs/features/generate-description/tasks.md", "PRD §14"]
---

# Pendientes de trabajo — 2026-10-30

> Base: commit `78797cd` en `chore/rsc-harness`. Todo lo marcado como **verificado** se
> ejecutó o se leyó en el repositorio hoy; lo marcado como **heredado** viene de la
> documentación y no se volvió a comprobar.

## Resumen ejecutivo

Las fases 1 a 4 del PRD están implementadas, pero la fase 4 no está cerrada y hay dos
barreras de calidad en rojo: `pnpm lint` falla por archivos del harness y la suite de
integración no corre sin Docker. Antes de encender la IA en producción faltan el endpoint y
la programación del mantenimiento, la decisión de hosting y el checklist de variables.
Después vienen PWA, E2E, CI y observabilidad (fases 5 y 6).

## Estado de los gates de calidad

| Gate | Comando | Resultado hoy | Detalle |
|------|---------|---------------|---------|
| Typecheck | `pnpm typecheck` | ✅ 0 errores | — |
| Build | `pnpm build` | ✅ 0 errores | 3 rutas: `/`, `/_not-found`, `/api/generate` |
| Lint | `pnpm lint` | ❌ 18 errores, 54 warnings | Todos en `.rsc/**` y `.opencode/rsc/**` (harness), no en `src/` |
| Pruebas | `pnpm test` | ⚠️ 474 pasan, 104 omitidas, 8 suites fallan | Las 8 fallan por Docker apagado, no por código |

Los 8 archivos que fallan son los que levantan `postgres:17-alpine`:
`budget-concurrency`, `budget-security`, `maintenance-runs`, `privileges`,
`quota-concurrency`, `rate-limit-concurrency`, `reconciliation` y `run-maintenance`.
`tests/integration/schema.test.ts` y `security.test.ts` no requieren contenedor y sí pasan.

## P0 — bloquea producción

1. **Lint en rojo por el harness.** `eslint.config.mjs` solo ignora `.next/`, `out/`,
   `build/` y `next-env.d.ts`. ESLint recorre `.rsc/` (incluidas copias en
   `.rsc/backups/`) y `.opencode/rsc/`, y ahí encuentra errores de
   `react-hooks/rules-of-hooks`. Arreglo mínimo: añadir `.rsc/**` y `.opencode/**` a
   `globalIgnores`. Verificado.
2. **Endpoint y programación del mantenimiento.** No existe ninguna ruta de mantenimiento
   (`src/app/api/` solo contiene `generate/`), así que T-004-8.6 y T-004-8.7 siguen
   pendientes. Nada invoca `run_maintenance()` en un horario (T-004-8.8), de modo que las
   reservas vencidas y los eventos viejos no se consolidan solos. Verificado.
3. **Decisión de hosting.** El PRD (§9) lo deja "pendiente de definición" y `README.md`
   asume Vercel. Sin esta decisión no se puede elegir el scheduler (pg_cron vs Vercel Cron)
   ni cerrar el checklist de variables. Verificado en PRD y README.
4. **Checklist de variables antes de encender IA:** `AI_ENABLED=true` y
   `AI_REAL_CALLS_ENABLED=true` solo en Production, al menos una API key, `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE_KEY`, y `TRUST_PROXY` revisado. Si `extractClientIp` devuelve
   `null`, todas las peticiones responden 429. `TRUST_PROXY` se lee en
   `src/lib/ratelimit/rateLimiter.ts:88`. Verificado.
5. **Privilegios de objetos nuevos.** La prueba de `9abf528` demuestra que los defaults de
   Supabase conceden `TRUNCATE` y `UPDATE` a `service_role` sobre tablas y secuencias
   nuevas. La 026 corrige lo existente; cada migración futura debe endurecer privilegios a
   mano. La deuda heredada B-01/B-02/B-03 sigue abierta. Verificado (test) y heredado
   (deuda).

## P1 — cierre de fase 4

- **Cierre documental y validación final de T-004:** `tasks.md` sigue diciendo que
  T-004-8.5 y T-004-8.5b están "sin commit", pero se commitearon en `6fb3c04`
  (2026-10-21). Ajustar la bitácora, `MEMORY.md` y `tasks.md` antes de declarar la fase
  cerrada. Verificado contra `git log`.
- **Integración sin Docker:** las suites no tienen `skip` condicional ni script aparte; sin
  Docker fallan en vez de omitirse. Conviene separar `pnpm test` de `pnpm test:integration`
  y decidir si CI usa un servicio PostgreSQL o Testcontainers.
- **Cobertura y carga:** no hay `@vitest/coverage-*`, umbral ni reporte, ni medición de p95
  o LCP automatizada, aunque la constitución fija objetivos.
- **Revisión del modelo Groq por defecto** (nota de T-003A): sigue pendiente.
- **`ip_rate_limits` huérfana:** la tabla existe con RLS, pero no tiene escritores desde la
  migración 018; leerla devuelve datos obsoletos. Decidir si se elimina o se documenta.

## P2 — fases 5 y 6

| Pendiente | Evidencia |
|-----------|-----------|
| PWA: manifest, service worker, iconos, offline, instalación (T-006) | `public/` solo tiene los 5 SVG de `create-next-app`; sin dependencia tipo Serwist |
| E2E con Playwright | No está en `package.json` ni en `scripts` |
| CI con GitHub Actions | No existe `.github/` |
| Observabilidad y alertas de gasto (T-007) | Fase 6 no iniciada; sin métricas ni trazas |
| Runbook de despliegue | No hay procedimiento probado |
| Publicidad modular `AdSlot` (RF-008) | Fase 6; solo reservado en diseño |
| README real | Sigue el boilerplate de `create-next-app` y menciona `app/page.tsx` en la raíz |

## Riesgos abiertos

- Un fallo al confirmar cuota o presupuesto devuelve 503 **después** de generar y cobrar:
  el usuario reintenta y consume otra unidad. Heredado.
- La auditoría en `generation_records` es best-effort: si la inserción falla, el consumo
  queda sin rastro. Heredado.
- El calendario de cuota (America/Mexico_City) y el del presupuesto (UTC) no coinciden en
  el cambio de mes. Heredado.
- Los `gaps.md` abiertos (runbook, PWA, CI, observabilidad) siguen vigentes.

## Orden recomendado

1. Arreglar `eslint.config.mjs` y dejar los cuatro gates en verde (P0-1).
2. Decidir hosting; con eso se desbloquea el scheduler (P0-3 y P0-2).
3. Completar T-004-8.6/8.7, programar mantenimiento y cerrar la fase 4 con documentación
   actualizada (P0-2 y P1).
4. Separar la suite de integración y montar CI (P1 y P2).
5. PWA y E2E (fase 5).
6. Observabilidad, publicidad y despliegue (fase 6).

## Cómo reproducir

```bash
git rev-parse --short HEAD   # 78797cd
pnpm typecheck
pnpm build
pnpm lint
pnpm test
```
