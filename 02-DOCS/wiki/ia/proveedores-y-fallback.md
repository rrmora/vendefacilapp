---
type: article
title: Proveedores y fallback
description: Cómo se eligen los proveedores de IA, qué errores disparan un reintento y cómo se evita cobrar dos veces.
resource: src/lib/ai/orchestrator.ts
tags: [ia, proveedores, fallback, presupuesto]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [proveedores-y-fallback]
topic: ia
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Especificación generate-description](../../raw/producto/spec-generate-description.md)"]
score: 9
---

# Proveedores y fallback

> Sources: VendeFácil AI, PRD MVP (sin fecha); Especificación generate-description (sin fecha)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [spec-generate-description](../../raw/producto/spec-generate-description.md)

## Overview

Tres adaptadores —Gemini, Groq y OpenAI— comparten una interfaz y se ejecutan en orden de
prioridad. El orquestador solo reintenta errores que tienen sentido reintentar, reserva
presupuesto antes de cada proveedor de pago y distingue con cuidado entre «no se envió» y
«se envió y falló», porque de esa distinción depende que se libere o se cobre una cuota.

## Adaptadores

| Proveedor | Endpoint | Modelo por defecto | Pago |
|-----------|----------|--------------------|------|
| Gemini | `v1beta/models/{model}:generateContent` | `gemini-2.5-flash` | No |
| Groq | `api.groq.com/openai/v1/chat/completions` | `llama-3.3-70b-versatile` | No |
| OpenAI | `api.openai.com/v1/chat/completions` | `gpt-4o-mini` | Sí |

Cada proveedor usa `fetch` nativo, su propio nombre de campo de tokens (`maxOutputTokens`,
`max_tokens`, `max_completion_tokens`) y marca `requestDispatched = true` justo antes del
`fetch`. Cualquier fallo anterior —falta de pricing, aborto del cliente— se considera no
enviado.

## Selección y orden

El orquestador filtra por `enabled`, API key presente y política de pago, y ordena por
prioridad (1 Gemini, 2 Groq, 3 OpenAI). Si no queda ninguno devuelve `INTERNAL_ERROR` con
`quotaDisposition: 'release'`.

El presupuesto global es de 25 s y cada intento recibe el tiempo restante, con un timeout
por proveedor de 15 s por defecto. Si el cliente aborta, el `abortSignal` se propaga.

## Qué dispara fallback

| Tipo | ¿Reintenta? | Notas |
|------|-------------|-------|
| `RATE_LIMITED` | Sí | 429 del proveedor |
| `PROVIDER_ERROR` | Sí | 5xx |
| `AUTH_ERROR` | Sí | credencial inválida: se pasa al siguiente, no se reintenta el mismo |
| `NOT_CONFIGURED` | Sí | modelo sin pricing o sin key |
| `SECURITY_BLOCK` | No | bloqueo de contenido: corta la cadena |
| `INVALID_REQUEST` | No | la petición está mal: reintentar no ayuda |
| `BUDGET_EXCEEDED` | No | se omiten los proveedores de pago restantes y se sigue con los gratuitos |

OpenAI distingue un 429 de cuota (`insufficient_quota`, `billing`) como `BUDGET_EXCEEDED`,
no como rate limit.

## Presupuesto por intento

Antes de llamar a un proveedor de pago se calcula el coste máximo y se reserva. Si la reserva
falla por umbral, se omiten los pagos y se continúa con los gratuitos. Si falla por
indisponibilidad, se aborta con `INTERNAL_ERROR`. Si el modelo no está en la tabla de precios,
no se llama.

Al terminar con éxito, el orquestador confirma la reserva. Si la confirmación falla, intenta
`consumeUnknown` y devuelve error aunque el proveedor haya respondido: prefiere no mentir
sobre el gasto antes que devolver un 200 con contabilidad rota.

## Disposición de cuota

El resultado incluye `quotaDisposition`:

- `complete` — se envió al menos una petición y la contabilidad cerró.
- `release` — no se envió nada; la reserva de cuota se puede liberar.
- `leave_uncertain` — se envió algo y la compensación falló; la reserva queda en
  `sent_uncertain` y no se libera.

El servicio de descripción traduce esa disposición en `release_quota` o `confirm_quota`, y si
la operación no se puede verificar responde 503 en lugar de asumir el resultado.

## Related

- [Prompt y costes](./prompt-y-costos.md) — qué se envía y cuánto cuesta cada token.
- [Controles antiabuso](../seguridad/controles-antiabuso.md) — lo que ocurre antes de llegar aquí.
- [RPC y mantenimiento](../base-de-datos/rpc-y-mantenimiento.md) — dónde se materializan reservas y disposiciones.
