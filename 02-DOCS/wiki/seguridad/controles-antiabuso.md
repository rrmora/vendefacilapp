---
type: article
title: Controles antiabuso
description: Rate limit por IP, cuota por visitante y el orden exacto de comprobaciones que protege al endpoint antes de gastar dinero.
resource: src/lib/ai/descriptionService.ts
tags: [seguridad, abuso, rate-limit, cuota]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [controles-antiabuso]
topic: seguridad
status: stable
sources: ["[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)", "[Bitácora de implementación](../../raw/producto/bitacora-de-implementacion.md)"]
score: 11
---

# Controles antiabuso

> Sources: VendeFácil AI, Especificación T-004 (sin fecha); Bitácora de implementación (2026-10)
> Raw: [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md); [bitacora-de-implementacion](../../raw/producto/bitacora-de-implementacion.md)

## Overview

El endpoint es público y cuesta dinero por llamada, así que cada petición atraviesa tres
puertas antes de tocar un proveedor: rate limit por IP, cuota diaria por visitante y reserva
de presupuesto. El diseño es fail-closed: si un control no puede verificar, responde 503 en
lugar de dejar pasar.

## Orden real de comprobaciones

1. **Configuración.** Si la IA está apagada, MOCK 200 sin consumir nada. Si está encendida
   pero las llamadas reales no están autorizadas, 503. Sin proveedor con key, 503.
2. **Identidad.** Sin `visitor_id` válido (UUID v4), 503. Sin IP normalizable, 429.
3. **Rate limit por IP.** Si la RPC falla, 503.
4. **Reserva de cuota.** `quota_exceeded` y `rate_limited` devuelven 429.
5. **Reserva de presupuesto** por proveedor de pago, dentro del orquestador.
6. **`mark_quota_sent`** justo antes de invocar la IA. Si falla, 503 sin llamar a nadie.
7. **Llamada con timeout** de 15 s por proveedor y 25 s global.
8. **Confirmar o liberar cuota** según la disposición.

El orden importa: la cuota se reserva antes de gastar y el presupuesto se reserva antes de
cada proveedor de pago, de modo que un fallo temprano no cuesta ni cuota ni dinero.

## Rate limit

Límites independientes de la cuota: 10 por minuto, 100 por hora y 500 por día, en ventana
móvil exacta sobre solicitudes **aceptadas**. La RPC serializa por IP con un advisory lock y
devuelve `allowed`, `rate_limited` con la ventana y `retry_after_seconds`, o `invalid_ip`.
Las solicitudes rechazadas no se registran.

La IP se valida con `net.isIP`, se recorta y se limita a 45 caracteres. Solo se confían
cabeceras de proxy (`cf-connecting-ip`, `true-client-ip`, `x-client-ip`, `x-real-ip`,
`x-forwarded-for`) si `TRUST_PROXY` o `TRUSTED_PROXIES` está activo. Sin esa variable no se
acepta ninguna cabecera y todas las peticiones caen en 429: es seguro, pero deja el endpoint
inutilizable en un despliegue mal configurado.

## Cuota por visitante

Cinco generaciones exitosas por visitante y día, contadas en `America/Mexico_City` con
locale `en-CA`. Se reserva una unidad antes de la llamada, se marca como enviada y se
confirma o libera al final. Los fallos no consumen; copiar nunca consume.

La identidad es una cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción, con UUID
generado por el servidor. El PRD es explícito: borrar cookies, cambiar de navegador o de
dispositivo da una identidad nueva. El objetivo es **reducir** el abuso, no prometer
impedirlo.

## Límites conocidos

- El handler no comprueba `Origin`/`Referer` ni exige token CSRF; la defensa es
  `SameSite=Lax`.
- El rate limit depende de una IP confiable; detrás de un proxy mal configurado no hay
  granularidad real.
- Si la confirmación de cuota o presupuesto falla después de una generación exitosa, el
  cliente recibe 503 aunque el texto se haya producido y el consumo quede registrado.
- La cuota usa calendario de Ciudad de México y el presupuesto mes UTC: cerca del cambio de
  mes ambos relojes discrepan.

## Related

- [Contratos y API](../arquitectura/contratos-y-api.md) — qué códigos ve el cliente.
- [RPC y mantenimiento](../base-de-datos/rpc-y-mantenimiento.md) — las funciones que implementan estos controles.
- [Proveedores y fallback](../ia/proveedores-y-fallback.md) — qué pasa después de las puertas.
