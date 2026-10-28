---
type: article
title: Privilegios y RLS
description: Cómo 026 reduce la superficie de la base de datos a service_role y qué deuda de privilegios queda abierta.
resource: supabase/migrations/026_minimum_privileges.sql
tags: [base-de-datos, seguridad, rls, privilegios]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [privilegios-y-rls]
topic: base-de-datos
status: draft
sources: ["[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)", "[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)"]
score: 13
---

# Privilegios y RLS

> Sources: VendeFácil AI, Bitácora de implementación (2026-10); Especificación T-004 (sin fecha)
> Raw: [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md); [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md)

## Overview

El diseño es de dos capas: RLS activo en todas las tablas, sin políticas, de modo que ningún
rol cliente ve filas; y una migración final (026) que revoca privilegios heredados y deja
`service_role` con lo mínimo para operar. Nada usa `SECURITY DEFINER`: no hay funciones que
eleven privilegios a espaldas del ejecutor.

## RLS sin políticas

Desde 006, las cinco tablas originales tienen RLS activo y cero políticas. En PostgreSQL eso
significa que solo los roles con `BYPASSRLS` —`service_role` en Supabase— pueden leer y
escribir; `anon` y `authenticated` no ven nada. 018 repite el patrón en
`ip_rate_limit_events`.

RLS por sí solo no basta: si los defaults de Supabase conceden `SELECT` a `anon`, una tabla
sin políticas igual queda cerrada, pero las **secuencias** y las **funciones** no están
protegidas por RLS. De ahí 026.

## Qué hace 026

1. **Funciones:** revoca `EXECUTE` de `PUBLIC`, `anon` y `authenticated` sobre las 16 RPC y
   lo concede solo a `service_role`. Sin esto, `reserve_quota` o `get_quota_status` podían
   ejecutarse desde el cliente con los defaults de Supabase.
2. **Tablas:** revoca `ALL` de `anon` y `authenticated` sobre cuota, presupuesto y
   generaciones, y también de `PUBLIC` para no depender de los defaults del proyecto.
3. **Secuencias:** concede `USAGE` explícito a `service_role` en las secuencias de
   `budget_tracking`, `budget_reservations` e `ip_rate_limit_events`. Sin `USAGE`, las RPC
   que insertan fallan aunque la tabla esté concedida (lo detectaron 014 y 018).
4. **Normalización de `service_role`:** sin `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`
   en tablas, y sin `SELECT`/`UPDATE` en secuencias. La excepción es `UPDATE` en
   `ip_rate_limit_events`, necesario para el `FOR UPDATE SKIP LOCKED` de la limpieza.

Todas las operaciones condicionan a `EXISTS (SELECT 1 FROM pg_roles ...)`, así que la
migración funciona igual en un PostgreSQL sin roles de Supabase.

## Por qué `SECURITY INVOKER`

`run_maintenance()` corre con los privilegios de quien la invoca. Eso evita que un rol
cualquiera ejecute borrados con permisos elevados, pero traslada la responsabilidad a los
grants: si `service_role` no tiene permisos sobre alguna tabla, la tarea falla con SQLSTATE
42501 y el run queda `partial`. 026 existe justamente para que eso no pase.

## Deuda pendiente

- **B-01/B-02/B-03:** en proyectos con defaults de Supabase persisten grants heredados sobre
  `budget_reservations_id_seq`, `ip_rate_limit_events_id_seq`, `maintenance_runs` e
  `ip_rate_limits`. 026 los reduce, pero el inventario de privilegios efectivos depende del
  entorno donde se aplique.
- **026 sin commitear:** la bitácora la marca como validada localmente y pendiente de
  aprobación/commit. Hasta que se aplique en producción, el estado real es el previo.
- **Tabla legada:** `ip_rate_limits` mantiene RLS pero no tiene escritores; sigue expuesta en
  los grants heredados aunque no se use.

## Cómo verificarlo

`tests/integration/privileges.test.ts` simula los defaults de Supabase, crea un rol sonda y
mide privilegios efectivos sobre tablas, secuencias y funciones. Es la prueba que evita que
un `GRANT ALL` nuevo reabra la superficie sin que nadie lo note.

## Related

- [Esquema y migraciones](./esquema-y-migraciones.md) — las tablas y secuencias implicadas.
- [RPC y mantenimiento](./rpc-y-mantenimiento.md) — qué necesita cada función para funcionar.
- [Secretos y entornos](../seguridad/secretos-y-entornos.md) — por qué la `service_role` key nunca sale del servidor.
