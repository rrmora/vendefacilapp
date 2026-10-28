---
type: article
title: RPC y mantenimiento
description: Las funciones atómicas de cuota, presupuesto y rate limit, y el orquestador run_maintenance con su auditoría.
resource: supabase/migrations/025_run_maintenance.sql
tags: [base-de-datos, rpc, mantenimiento, idempotencia]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [rpc-y-mantenimiento]
topic: base-de-datos
status: stable
sources: ["[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)"]
score: 13
---

# RPC y mantenimiento

> Sources: VendeFácil AI, Bitácora de implementación (2026-10); Especificación T-004 (sin fecha)
> Raw: [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md)

## Overview

Toda la lógica sensible vive en funciones de PostgreSQL para que sea atómica y no dependa de
la concurrencia de la aplicación. Son 16 funciones, todas ejecutables solo por
`service_role`. La aplicación las invoca con `callRpc` y traduce sus respuestas a estados de
dominio; ninguna lógica de conteo se hace en TypeScript.

## Cuota

- `reserve_quota(visitor, fecha, reserva)` — inserta la fila del día si falta, la bloquea con
  `FOR UPDATE`, rechaza si `generations_used >= max_generations` o si hay 3 reservas
  `pending`, incrementa el contador y crea la reserva con 5 minutos de vida.
- `mark_quota_sent(reserva)` — transición `pending → sent_uncertain`, solo antes de llamar al
  proveedor. Repetirla devuelve `already_sent`.
- `confirm_quota(reserva)` — acepta `pending` y `sent_uncertain` y deja la reserva
  `completed`.
- `release_quota(reserva)` — acepta `pending` y `sent_uncertain`, descuenta del contador del
  día original y deja `released`. Es idempotente: repetir devuelve `already_processed`.
- `get_quota_status(visitor, fecha)` — lectura del estado del día.
- `expire_pending_reservations()` — marca `completed` las reservas con generación exitosa y
  expira solo las `pending` vencidas.

La regla de oro: **`sent_uncertain` nunca se libera automáticamente**. Si el proceso muere
después de enviar la petición, se prefiere cobrar de más a regalar una generación.

## Presupuesto

- `reserve_budget(reserva, mes, maxCost, total)` — bloquea `budget_tracking`, es idempotente
  por `reservation_id` y rechaza si el coste es negativo. El umbral operativo es el 95 %:
  rechaza cuando `spent + reserved + maxCost >= total * 0.95`.
- `confirm_budget(reserva, coste, estimado)` — suma a `spent_usd`, resta lo reservado y marca
  `confirmed`. Idempotente (`already_processed` / `not_found`).
- `release_budget(reserva)` — solo resta `reserved_usd`.
- `get_budget_status(mes, coste)` — consulta previa.
- `reconcile_pending_budget_reservations(intervalo)` — cierra reservas huérfanas.

## Rate limit

- `check_rate_limit(ip)` — ventana móvil exacta sobre eventos aceptados: 10/minuto,
  100/hora, 500/día. Serializa por IP con `pg_advisory_xact_lock` y captura
  `clock_timestamp()` una sola vez después del bloqueo. Devuelve `allowed`,
  `rate_limited` con ventana y `retry_after_seconds`, o `invalid_ip`.

Solo se registran las solicitudes aceptadas; las rechazadas no generan fila.

## Limpieza

- `cleanup_rate_limit_events_core` y `cleanup_rate_limit_events` — borran eventos con
  retención mínima de 25 h, en lotes y con `FOR UPDATE SKIP LOCKED`.
- `cleanup_rate_limit_events_status` — variante que informa `completed` o `already_running`.

## Mantenimiento

`run_maintenance()` toma un advisory lock global. Si está ocupado devuelve
`{"run_id": null, "status": "already_running"}` sin auditar. Si no, crea una fila en
`maintenance_runs` y ejecuta, en orden y con un bloque `EXCEPTION` independiente por tarea:

1. expiración de reservas de cuota,
2. reconciliación de reservas de presupuesto,
3. limpieza de eventos de rate limit.

El estado final es `success` con 0 fallos, `partial` con 1–2 y `failed` con 3.
`finished_at` usa `GREATEST(clock_timestamp(), started_at)` para no retroceder en el tiempo.
La función es `SECURITY INVOKER`: quien la ejecuta necesita los privilegios de las tablas y de
`maintenance_runs`, y por eso 026 concede esos grants.

## Lo que no hace

Nada invoca `run_maintenance()` en un horario. No hay `pg_cron`, ni job de Vercel, ni cron
externo en el repositorio: la consolidación de reservas vencidas y la limpieza dependen de
una llamada manual o de un scheduler que aún no existe.

## Related

- [Esquema y migraciones](./esquema-y-migraciones.md) — las tablas que estas funciones mueven.
- [Privilegios y RLS](./privilegios-y-rls.md) — por qué `SECURITY INVOKER` obliga a conceder grants.
- [Presupuesto y costes](../ia/prompt-y-costos.md) — de dónde salen los importes reservados.
