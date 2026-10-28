---
type: article
title: Esquema y migraciones
description: Las ocho tablas del sistema, sus invariantes y cómo las 26 migraciones secuenciales llegaron al esquema actual.
resource: supabase/migrations/
tags: [base-de-datos, postgresql, migraciones, esquema]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [esquema-y-migraciones]
topic: base-de-datos
status: stable
sources: ["[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)"]
score: 11
---

# Esquema y migraciones

> Sources: VendeFácil AI, Bitácora de implementación (2026-10); Especificación T-004 (sin fecha)
> Raw: [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md)

## Overview

La persistencia operativa vive en PostgreSQL (Supabase) y existe solo para tres cosas: contar
cuota por visitante, limitar peticiones por IP y controlar el gasto de proveedores. No guarda
productos, usuarios ni descripciones. El esquema se construyó en 26 migraciones numeradas y
nunca se edita una migración ya aplicada.

## Tablas

| Tabla | Para qué | Invariantes clave |
|-------|----------|-------------------|
| `visitor_daily_quota` | Contador diario por visitante | Único `(visitor_id, quota_date)`; `generations_used >= 0`; `max_generations > 0`; default 5 |
| `quota_reservations` | Reservas atómicas de una generación | Estados `pending`, `completed`, `released`, `expired`, `sent_uncertain`; `expires_at > created_at` |
| `generation_records` | Auditoría de cada intento de proveedor | Tokens y coste `>= 0`; FK a reserva con `ON DELETE SET NULL` |
| `budget_tracking` | Gasto mensual acumulado | Un registro por mes `YYYY-MM` |
| `budget_reservations` | Reservas de presupuesto por llamada | Idempotente por `reservation_id`; estados `reserved`, `confirmed`, `released` |
| `ip_rate_limits` | Rate limit legado por cubetas fijas | **Sin escritores desde 018**; se conserva por historial |
| `ip_rate_limit_events` | Eventos para ventana móvil | Un registro por solicitud aceptada; índice `(ip_address, accepted_at DESC)` |
| `maintenance_runs` | Auditoría del mantenimiento | Estados `running`, `success`, `partial`, `failed`; `duration_ms` generado |

## Cómo se cuenta una generación

La cuota no se incrementa con un `UPDATE` suelto: se **reserva** una fila con expiración de
cinco minutos, se marca como enviada justo antes de llamar al proveedor y se confirma o se
libera al final. Ese diseño permite distinguir «no se llamó» de «se llamó y no sabemos si
cobró», que es la diferencia entre liberar cuota y dejarla incierta.

## Evolución por bloques

- **001–006:** tablas base (`visitor_daily_quota`, `quota_reservations`, `generation_records`,
  `budget_tracking`, `ip_rate_limits`) y activación de RLS sin políticas.
- **007–011:** RPC de cuota: reservar, confirmar, liberar, consultar estado y expirar reservas.
- **012:** primer rate limit por cubetas fijas.
- **013–014:** reservas de presupuesto y su aseguramiento de privilegios.
- **015–016:** reconciliación de reservas de cuota y presupuesto contra generaciones exitosas.
- **017:** protección de reservas: nuevo estado `sent_uncertain` y `mark_quota_sent`.
- **018:** ventana móvil exacta de rate limit y tabla `ip_rate_limit_events`; deja `ip_rate_limits`
  sin escritores.
- **019–021:** correcciones de la expiración (agrupación por visitante y fecha), de la
  reconciliación de presupuesto (por mes) y de `completed_at` con `GREATEST(clock_timestamp(),
  created_at)`.
- **022–025:** limpieza global de eventos con retención mínima de 25 h, tabla `maintenance_runs`,
  estado de limpieza y `run_maintenance()` como orquestador con advisory lock.
- **026:** privilegios mínimos por tabla, secuencia y función.

## Reglas para cambiar el esquema

1. Una migración nueva, numerada y secuencial; nunca editar ni renumerar una existente.
2. Idempotencia (`IF NOT EXISTS`, `CREATE OR REPLACE`) para poder reaplicar en entornos limpios.
3. Toda tabla nueva con RLS activo y sin políticas para clientes.
4. Toda función nueva debe entrar en la lista de `EXECUTE` de 026.
5. Los tests de integración aplican las migraciones en orden; el test de esquema verifica que
   las 26 se apliquen sin error.

## Related

- [RPC y mantenimiento](./rpc-y-mantenimiento.md) — la semántica de cada función.
- [Privilegios y RLS](./privilegios-y-rls.md) — quién puede tocar cada objeto.
- [Controles antiabuso](../seguridad/controles-antiabuso.md) — cómo se usan estas tablas en runtime.
