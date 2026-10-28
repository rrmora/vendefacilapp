---
type: article
title: Contratos y API
description: El contrato público de generación, sus códigos de error, el mapeo a estados HTTP y el manejo de la cookie de visitante.
resource: src/types/description.ts
tags: [arquitectura, api, contrato, errores]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [contratos-y-api]
topic: arquitectura
status: stable
sources: ["[Especificación generate-description](../../raw/producto/spec-generate-description.md)", "[Especificación T-004](../../raw/producto/spec-t004-blindaje-antiproduccion.md)"]
score: 13
---

# Contratos y API

> Sources: VendeFácil AI, Especificación generate-description (sin fecha); Especificación T-004 (sin fecha)
> Raw: [spec-generate-description](../../raw/producto/spec-generate-description.md); [spec-t004-blindaje-antiproduccion](../../raw/producto/spec-t004-blindaje-antiproduccion.md)

## Overview

Hay un único endpoint, un contrato de entrada de cuatro campos y una respuesta que es una
unión discriminada éxito/error. Los códigos públicos son cinco y no exponen nada del
proveedor; el estado HTTP y el código de error se mapean en un solo lugar. La cookie de
visitante es la única identidad del sistema y también parte del contrato observable.

## Entrada

`IDescriptionRequest` (`src/types/description.ts`) exige:

- `category`: `ropa | electronica | hogar | vehiculos | otros`.
- `condition`: `nuevo | como_nuevo | buen_estado | detalles_uso`.
- `pricingType`: `fijo | negociable`.
- `userNotes`: cadena de 3 a 500 caracteres.

El handler parsea el cuerpo con tolerancia a JSON inválido y valida con Zod
(`src/features/description/schemas/description.schema.ts`). Un fallo devuelve 400 con
`errorCode: VALIDATION_ERROR` y la lista de campos inválidos. Los campos extra no se
rechazan.

## Respuesta

Unión discriminada sobre `success`:

```ts
type IDescriptionResponse =
  | { success: true; generatedText: string; tokensUsed: number | null }
  | { success: false; errorCode: DescriptionErrorCode; errorMessage: string };
```

`generatedText` es texto plano con emojis y saltos de línea permitidos. `tokensUsed` solo
aparece si el total reportado es coherente; en modo MOCK es `null`.

## Códigos públicos

`VALIDATION_ERROR`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `BUDGET_EXCEEDED` e
`INTERNAL_ERROR`. `SECURITY_BLOCK` e `INVALID_REQUEST` —los dos que delatan detalles del
proveedor— se degradan a `INTERNAL_ERROR` de cara al cliente. **No existe un código
público de cuota**: cuando la cuota diaria se agota, la respuesta es 429 `RATE_LIMITED`.

## Mapeo HTTP

| Situación | Estado | Código |
|-----------|--------|--------|
| Éxito (real o MOCK) | 200 | — |
| Cuerpo inválido | 400 | `VALIDATION_ERROR` |
| Presupuesto agotado | 402 | `BUDGET_EXCEEDED` |
| Rate limit o cuota agotada | 429 | `RATE_LIMITED` |
| Proveedores caídos o no configurados | 503 | `PROVIDER_UNAVAILABLE` |
| Fallo interno, compensación fallida o cuota no confirmada | 503 | `INTERNAL_ERROR` |
| Código de error no contemplado | 500 | El que venga en el resultado |
| Método distinto de POST | 405 | `INTERNAL_ERROR` |

## Cookie de visitante

Si no hay cookie válida, el handler genera un UUID v4 y la emite con `httpOnly`,
`sameSite=lax`, `secure` en producción, `path=/` y un año de vigencia. El cliente nunca
elige su identificador: una cookie manipulada o con formato inválido se descarta y se
reemplaza. Esta cookie es la base de la cuota diaria, no un mecanismo de autenticación.

## Límites conocidos del contrato

- No hay verificación de `Origin`/`Referer` ni token CSRF; la defensa es `SameSite=Lax`.
- No existe un contrato de «cuota restante»: el PRD lo deja pendiente y la UI no recibe ese
  número por API.
- `tokensUsed` es informativo y best-effort; no debe usarse para facturación exacta.

## Related

- [Capas y módulos](./capas-y-modulos.md) — dónde se implementa cada parte del contrato.
- [Flujo de generación](../producto/flujo-de-generacion.md) — cómo consume la UI estos estados.
- [Controles antiabuso](../seguridad/controles-antiabuso.md) — qué hay detrás de 429 y 402.
