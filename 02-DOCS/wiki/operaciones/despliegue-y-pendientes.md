---
type: article
title: Despliegue y pendientes
description: Lo que exige producción, lo que falta antes de publicar y las inconsistencias documentales que conviene corregir.
resource: MEMORY.md
tags: [operaciones, despliegue, deuda, vercel]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [despliegue-y-pendientes]
topic: operaciones
status: draft
sources: ["[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)"]
score: 13
---

# Despliegue y pendientes

> Sources: VendeFácil AI, Bitácora de implementación (2026-10); PRD MVP (sin fecha)
> Raw: [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [prd-vendefacil](../../raw/producto/prd-vendefacil.md)

## Overview

El código está listo para correr en modo MOCK en cualquier entorno y para llamadas reales en
producción, pero publicar de verdad exige cuatro cosas que hoy no están cerradas: configurar
IP/proxy, aplicar la migración 026, programar el mantenimiento y crear CI. El hosting sigue
sin decisión formal, aunque la documentación asume Vercel.

## Checklist mínimo antes de encender la IA

1. `AI_ENABLED=true` y `AI_REAL_CALLS_ENABLED=true` **solo** en el scope Production.
2. Al menos una `AI_*_API_KEY` válida; OpenAI además `AI_OPENAI_ENABLED=true`.
3. `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` configuradas como variables de servidor.
4. `TRUST_PROXY` (o `TRUSTED_PROXIES`) revisado según cómo Vercel entrega la IP. Sin esto,
   `extractClientIp` devuelve `null` y todas las peticiones responden 429.
5. Migraciones aplicadas en orden hasta la 026.
6. Nuevo deployment tras cualquier cambio de variables: la configuración se cachea.

## Pendientes técnicos

| Pendiente | Impacto | Evidencia |
|-----------|---------|-----------|
| 026 sin commitear | Privilegios heredados siguen activos en producción | Bitácora T-004-8.5 |
| Sin scheduler de mantenimiento | Reservas vencidas y eventos viejos no se consolidan solos | Solo existe `run_maintenance()` |
| Sin CI | Lint, typecheck, pruebas y build dependen de ejecución manual | No hay `.github/workflows` |
| Sin PWA | No hay manifest, service worker ni iconos propios | `public/` solo tiene SVG de ejemplo |
| Sin E2E | El flujo completo no se prueba en navegador | Playwright no instalado |
| Sin observabilidad | No hay métricas, trazas ni alertas de gasto | Fase 6 no iniciada |
| Hosting indefinido | La configuración asume Vercel sin decisión registrada | PRD §9 |

## Inconsistencias documentales

- **`README.md`** conserva el boilerplate de `create-next-app`. La sección de IA es útil, pero
  la guía de arranque habla de `app/page.tsx` en la raíz y no menciona `pnpm test` ni las
  migraciones.
- **`supabase/README.md`** documenta el revert solo para las cinco tablas iniciales: no
  incluye `budget_reservations`, `ip_rate_limit_events` ni `maintenance_runs`.
- **`ip_rate_limits`** sigue existiendo y con RLS, pero no tiene escritores desde 018. Leerla
  da datos obsoletos.
- **`MEMORY.md`** se detiene antes de los últimos cambios y sus totales de pruebas quedaron
  atrás.

## Riesgos operativos

- Un fallo de confirmación de cuota o presupuesto devuelve 503 después de haber generado y
  cobrado; el usuario reintenta y consume otra unidad.
- La auditoría en `generation_records` es best-effort: si la inserción falla, el consumo
  queda sin rastro.
- El calendario de cuota (Ciudad de México) y el del presupuesto (UTC) no coinciden en el
  cambio de mes.

## Related

- [Secretos y entornos](../seguridad/secretos-y-entornos.md) — el detalle de cada interruptor.
- [Estrategia de pruebas](../calidad/estrategia-de-pruebas.md) — lo que falta para tener CI.
- [Privilegios y RLS](../base-de-datos/privilegios-y-rls.md) — el alcance real de la migración pendiente.
