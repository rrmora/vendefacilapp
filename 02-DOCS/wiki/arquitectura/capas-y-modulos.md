---
type: article
title: Capas y módulos
description: Cómo se reparte el código en presentación, API, aplicación e infraestructura, y qué reglas de dependencia lo mantienen simple.
resource: src/
tags: [arquitectura, modularidad, nextjs]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [capas-y-modulos]
topic: arquitectura
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Plan generate-description](../../raw/producto/plan-generate-description.md)"]
score: 5
---

# Capas y módulos

> Sources: VendeFácil AI, PRD MVP (sin fecha); Plan generate-description (2026-10-11)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [plan-generate-description](../../raw/producto/plan-generate-description.md)

## Overview

El PRD define cuatro capas y prohíbe explícitamente microservicios y sobreingeniería. El
repositorio las materializa en un solo proceso Next.js: componentes React en
`src/components`, un Route Handler en `src/app/api`, casos de uso en `src/lib` y adaptadores
externos (proveedores de IA y Supabase) aislados al final de la cadena.

## Mapa de capas

| Capa | Responsabilidad | Dónde vive |
|------|-----------------|------------|
| Presentación | Formulario, estados, resultado, accesibilidad | `src/components/description/`, `src/app/page.tsx`, `src/components/ui/` |
| API | Contrato HTTP, validación, cookies, mapeo de errores | `src/app/api/generate/route.ts`, `src/features/description/schemas/` |
| Aplicación | Casos de uso, cuota, rate limit, presupuesto, orquestación | `src/lib/ai/`, `src/lib/quota/`, `src/lib/ratelimit/`, `src/lib/budget/`, `src/lib/visitors/` |
| Infraestructura | Clientes de IA, persistencia, registro de consumo | `src/lib/ai/providers/`, `src/lib/db/`, `src/lib/generations/` |

La dirección de dependencia es hacia dentro: los componentes conocen el cliente HTTP
(`src/features/description/services/descriptionApi.ts`), el handler conoce el servicio, y el
servicio conoce proveedores y RPC. Ningún adaptador importa componentes ni el handler.

## Flujo de una petición

`DescriptionForm` → `descriptionApi` → `POST /api/generate` → `generateDescription` →
(rate limit → cuota → presupuesto → orquestador → proveedor) → `IDescriptionResponse` →
`DescriptionResult`.

El servicio es el único punto que decide el orden de los controles y el que traduce el
resultado del orquestador a contrato público. Los proveedores solo saben hablar con su API
externa y devolver texto, tokens o un error tipado.

## Reglas de diseño visibles

- **Una sola puerta de entrada HTTP.** `POST /api/generate`; todo lo demás responde 405.
- **Contratos en `src/types/`.** Los tipos públicos no dependen de detalles de proveedor.
- **Errores tipados.** `src/lib/ai/errors.ts` clasifica y decide qué se puede reintentar;
  la conversión a mensaje público oculta detalles internos.
- **Persistencia encapsulada.** `src/lib/db/supabaseClient.ts` expone `callRpc` y permite
  inyectar un cliente falso en pruebas.
- **Configuración por entorno, cacheada.** `src/lib/ai/config.ts` construye la lista de
  proveedores una vez y la reutiliza.

## Consecuencias

La simplicidad tiene costo: la capa de aplicación concentra mucha responsabilidad en
`descriptionService.ts` y `orchestrator.ts`, y el estado de la transacción se reparte entre
varias RPC. Cualquier cambio en el orden de los controles afecta cuota, presupuesto y
auditoría a la vez, así que ese archivo es el punto de mayor riesgo del sistema.

## Related

- [Contratos y API](./contratos-y-api.md) — la frontera exacta entre capa de presentación y servidor.
- [Pipeline de proveedores y fallback](../ia/proveedores-y-fallback.md) — el interior de la capa de aplicación.
- [Esquema y migraciones](../base-de-datos/esquema-y-migraciones.md) — la capa de infraestructura del lado de datos.
