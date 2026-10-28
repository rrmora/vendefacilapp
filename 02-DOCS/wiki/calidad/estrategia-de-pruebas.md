---
type: article
title: Estrategia de pruebas
description: Qué cubre la suite de Vitest, cómo se prueban las RPC contra PostgreSQL real y qué falta (cobertura y CI).
resource: tests/
tags: [calidad, pruebas, vitest, postgresql]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [estrategia-de-pruebas]
topic: calidad
status: stable
sources: ["[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)"]
score: 7
---

# Estrategia de pruebas

> Sources: VendeFácil AI, Bitácora de implementación (2026-10); Especificación T-004 (sin fecha)
> Raw: [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md)

## Overview

Una sola orden —`pnpm test`, que ejecuta `vitest run`— cubre pruebas unitarias, de API, de
componentes y de integración con PostgreSQL. No hay script separado ni cobertura configurada.
La barrera de calidad es que la suite pase completa, más lint, typecheck y build.

## Capas de prueba

| Capa | Qué verifica | Dónde |
|------|--------------|-------|
| Unitarias de dominio | Cuota, presupuesto, rate limit, visitantes, cliente Supabase | `tests/lib/` |
| IA | Configuración, errores, orquestador, prompt, tokens, tipos | `tests/lib/ai/` |
| Proveedores | Parseo de respuesta, clasificación HTTP, pre-envío | `tests/lib/ai/providers/` |
| API | Contrato, cookie, matriz de protecciones A–P | `tests/api/` |
| Componentes | Formulario, resultado, contador de caracteres | `tests/components/description/` |
| Integración | RPC y esquema contra PostgreSQL 17 real | `tests/integration/` |

La matriz A–P de `tests/api/generate.t004-6.test.ts` es el documento ejecutable de las
protecciones: cada fila corresponde a una condición de borde del endpoint.

## Integración con PostgreSQL

Las suites de `tests/integration/` levantan un contenedor `postgres:17-alpine` por suite,
aplican las 26 migraciones en orden y usan `psql` para sembrar y consultar. Cubren:

- esquema completo y bloque estático de 026;
- concurrencia de cuota, rate limit y presupuesto;
- reconciliación de reservas;
- limpieza de eventos y retención de 25 h;
- `maintenance_runs` y `run_maintenance`;
- privilegios efectivos con un rol sonda.

Requieren Docker. No hay `skip` condicional ni script aparte: en un entorno sin Docker la
suite completa falla.

## Volumen y evidencia

La bitácora reporta 434/434 pruebas tras T-004-8.5, más 12 pruebas de integración de
privilegios añadidas en T-004-8.5b sin total global actualizado. También registra corridas
completas de lint, typecheck y build junto a la suite.

Esos números son una foto, no una garantía: el total cambia con cada tanda y `MEMORY.md` no
siempre se actualiza al mismo ritmo que el código.

## Lo que no existe

- **Cobertura:** no hay `@vitest/coverage-*`, ni umbral, ni reporte. La constitución exige
  suite verde y una prueba por feature, no un porcentaje.
- **E2E:** Playwright estaba previsto para Fase 5 y no está instalado.
- **CI:** no hay `.github/workflows`; todo se ejecuta localmente.
- **Pruebas de carga:** no hay medición de latencia p95 ni de LCP automatizada, aunque la
  constitución fija esos objetivos.

## Related

- [Estado y hoja de ruta](../producto/estado-y-hoja-de-ruta.md) — qué fase incluye E2E y CI.
- [Esquema y migraciones](../base-de-datos/esquema-y-migraciones.md) — lo que validan las suites de integración.
- [Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md) — la deuda operativa que estas pruebas no cubren.
