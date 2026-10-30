---
type: article
title: Prompt y costes
description: Reglas del prompt de sistema, normalización de tokens y el modelo de coste con presupuesto mensual y umbral del 95 %.
resource: src/lib/ai/prompt.ts
tags: [ia, prompt, costes, presupuesto]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [prompt-y-costos]
topic: ia
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Especificación generate-description](../../raw/producto/spec-generate-description.md)"]
score: 7
---

# Prompt y costes

> Sources: VendeFácil AI, PRD MVP (sin fecha); Especificación generate-description (sin fecha)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [spec-generate-description](../../raw/producto/spec-generate-description.md)

## Overview

El prompt es corto y defensivo: instruye un texto en español, en texto plano, con emojis
moderados, y prohíbe inventar. Los datos del usuario se encapsulan entre delimitadores que se
eliminan de la entrada para que no puedan cerrar el bloque. El coste se estima con una tabla
de precios fija, se reserva antes de llamar y se confirma con los tokens reales.

## Reglas del prompt

El sistema pide una descripción comercial en español, fácil de leer, con emojis moderados,
reutilizable en distintas plataformas y con tono natural. Prohíbe explícitamente inventar
precios, accesorios, garantías, certificaciones o ubicaciones, y prohíbe afirmar
certificaciones que no estén en los datos.

El bloque de datos va entre `<<<DATOS_DEL_PRODUCTO>>>` y `<<<FIN_DATOS_DEL_PRODUCTO>>>`, y se
instruye al modelo a tratarlo como datos, nunca como instrucciones. Las apariciones literales
de esos delimitadores en `userNotes` se eliminan antes de insertar el texto: primera defensa
contra prompt injection.

`variant` existe en el prompt para cambiar el enfoque de redacción, pero el servicio envía
siempre `0`. La variación está implementada y desconectada.

## Tokens

- Todo token se normaliza a entero seguro `>= 0`; valores incoherentes se anulan.
- El output facturable es `output + reasoning`; si falta cualquiera de los dos, no se calcula.
- `tokensUsed` público solo se devuelve si el total es coherente.

Los proveedores no siempre reportan uso: Gemini, Groq y OpenAI tienen formas distintas y
algunas respuestas lo omiten. En ese caso el coste se marca como estimado.

## Tabla de precios

Precios por millón de tokens y máximos usados para la reserva:

| Modelo | Input USD/1M | Output USD/1M | Max input | Max output |
|--------|--------------|---------------|-----------|------------|
| `gemini-2.5-flash` | 0.15 | 0.60 | 8192 | 1024 |
| `llama-3.3-70b-versatile` | 0.59 | 0.79 | 8192 | 1024 |
| `gpt-4o-mini` | 0.15 | 0.60 | 8192 | 1024 |

Coste máximo = `(maxInput * precioInput + maxOutput * precioOutput) / 1e6`, redondeado a 6
decimales. Es deliberadamente conservador: se reserva el peor caso, no el esperado.

## Coste real

Si el proveedor reporta tokens, se usan esos. Si el coste es estimado, se aplican
`AI_MAX_TOKENS_DEFAULT_INPUT` (400) y `AI_MAX_TOKENS_DEFAULT_OUTPUT` (200) como supuestos.
Los importes se redondean a 6 decimales antes de persistir.

## Presupuesto

- `AI_MONTHLY_BUDGET_USD` con default de 5 USD.
- El mes se calcula en **UTC**, no en la zona de la cuota.
- La reserva rechaza cuando `spent + reserved + maxCost >= total * 0.95`: el 5 % restante es
  colchón para desviaciones de precio.
- Solo OpenAI es de pago; agotar el presupuesto degrada a Gemini/Groq en lugar de fallar.

## Consecuencias

El sistema no promete un límite financiero absoluto: si varios procesos reservan a la vez y
el proveedor cobra más de lo estimado, el margen puede agotarse antes de que la contabilidad
lo refleje. El 95 % y la reserva por peor caso existen para que eso sea improbable, no
imposible.

## Related

- [Proveedores y fallback](./proveedores-y-fallback.md) — dónde se usa esta tabla de precios.
- [RPC y mantenimiento](../base-de-datos/rpc-y-mantenimiento.md) — la RPC que aplica el umbral.
- [Stack y configuración](../stack/stack-y-configuracion.md) — los nombres exactos de estas variables.
