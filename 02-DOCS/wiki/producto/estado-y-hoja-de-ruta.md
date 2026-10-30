---
type: article
title: Estado y hoja de ruta
description: Qué fases del MVP están cerradas, qué está validado pero no publicado y qué falta para un despliegue comercial.
resource: MEMORY.md
tags: [producto, roadmap, estado]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [estado-y-hoja-de-ruta]
topic: producto
status: draft
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[Plan generate-description](../../raw/producto/plan-generate-description.md)"]
score: 8
---

# Estado y hoja de ruta

> Sources: VendeFácil AI, PRD MVP (sin fecha); Bitácora de implementación T-001…T-004 (2026-10); Plan generate-description (2026-10-11)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [plan-generate-description](../../raw/producto/plan-generate-description.md)

## Overview

El proyecto recorrió las fases 1 a 4 del PRD y se detuvo antes de la 5. La generación real
está implementada y blindada, pero permanece apagada por variables de entorno; PWA, E2E y
CI no existen todavía. La documentación operativa (`MEMORY.md`) va por detrás del código en
los últimos puntos, así que este artículo separa lo verificado en el repositorio de lo que
solo está reportado.

## Fases del PRD

| Fase | Contenido | Estado observado |
|------|-----------|------------------|
| 1 — Scaffolding | Next.js, TS, Tailwind, contrato, API MOCK, pruebas iniciales | Cerrada |
| 2 — UI Mobile First | Formulario de cuatro campos, validaciones, copiar, regenerar, errores | Cerrada |
| 3 — Integración de IA | Adaptadores Gemini/Groq/OpenAI, orquestador, fallback, prompts | Cerrada, llamadas apagadas por defecto |
| 4 — Seguridad y cuotas | Supabase, rate limit, cuota, presupuesto, concurrencia | Cerrada en código; última migración sin commitear |
| 5 — PWA y calidad | Manifest, service worker, offline, accesibilidad, E2E | No iniciada |
| 6 — Preparación comercial | Observabilidad, CI, hosting, despliegue, anuncios | No iniciada |

## Lo que sí está hecho

- Endpoint `POST /api/generate` con validación Zod, cookie de visitante y mapeo de errores.
- Tres adaptadores de proveedor con `fetch` nativo, clasificación de errores y detección de
  petición realmente enviada.
- Orquestador con prioridad, presupuesto global de 25 s, fallback selectivo y reserva de
  presupuesto por proveedor de pago.
- Cuota diaria por visitante, rate limit por IP en ventana móvil, presupuesto mensual y
  registro de consumo, todo en PostgreSQL con RPC atómicas.
- 26 migraciones, RLS activo y una migración de privilegios mínimos (026).
- Suite de pruebas unitarias, de API, de componentes y de integración con PostgreSQL.

## Lo que falta o está en duda

- **PWA:** no hay `manifest`, service worker ni iconos propios; `public/` solo contiene los
  SVG de ejemplo de `create-next-app`.
- **E2E:** Playwright estaba planificado para Fase 5 y no aparece en dependencias ni en
  scripts.
- **CI:** no existe `.github/workflows`; lint, typecheck, pruebas y build se ejecutan a mano.
- **Hosting:** el PRD lo deja pendiente; `README.md` asume Vercel para los scopes de
  variables.
- **Migración 026:** validada localmente pero no commiteada, según la bitácora. La deuda
  B-01/B-02/B-03 de privilegios heredados sigue abierta.
- **Mantenimiento programado:** `run_maintenance()` existe, pero nada lo invoca en un
  horario.

## Cómo leer el estado

`MEMORY.md` es la fuente narrativa más rica y también la más desfasada: sus totales de
pruebas y su lista de pendientes se detienen antes de la última tanda. Para decisiones usa
[MEMORY](../../raw/producto/bitacora-de-implementacion.md) con cautela y contrasta con el
código; para el detalle del despliegue, [Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md).

## Related

- [Visión y alcance del producto](./vision-y-alcance.md) — qué promete el MVP y qué no.
- [Estrategia de pruebas](../calidad/estrategia-de-pruebas.md) — qué cubre la suite actual.
- [Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md) — la lista accionable antes de publicar.
