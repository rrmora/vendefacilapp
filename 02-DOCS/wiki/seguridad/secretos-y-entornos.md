---
type: article
title: Secretos y entornos
description: Cómo se separan las claves del servidor, qué interruptores impiden llamadas reales y cómo se evita filtrar datos en errores y logs.
resource: .env.example
tags: [seguridad, secretos, entornos, configuracion]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [secretos-y-entornos]
topic: seguridad
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Constitución SDD](../../raw/meta/constitucion-sdd.md)"]
score: 9
---

# Secretos y entornos

> Sources: VendeFácil AI, PRD MVP (sin fecha); Constitución SDD v1.1.0 (2026-10-27)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [constitucion-sdd](../../raw/meta/constitucion-sdd.md)

## Overview

Todas las credenciales viven en variables de servidor y ninguna lleva prefijo
`NEXT_PUBLIC_`. Dos interruptores independientes impiden llamadas reales por defecto, y el
sistema falla cerrado si falta cualquiera de las condiciones. Los errores que ve el cliente
no contienen claves, tokens, prompts ni datos personales.

## Doble interruptor

| Entorno | `AI_ENABLED` | `AI_REAL_CALLS_ENABLED` | Resultado |
|---------|--------------|-------------------------|-----------|
| Production | `true` | `true` | Flujo real si hay proveedor, cuota y presupuesto |
| Preview | `false` o ausente | `false` o ausente | MOCK |
| Development | `false` o ausente | `false` o ausente | MOCK |

Con `AI_ENABLED=false` el endpoint devuelve una descripción MOCK con 200 y **no** consulta
Supabase ni proveedores: es el modo seguro por defecto y el que usan las pruebas.

Con `AI_ENABLED=true` y `AI_REAL_CALLS_ENABLED=false` responde 503 antes de reservar cuota o
presupuesto. Esa segunda barrera permite desplegar el código de IA sin habilitarlo.

`AI_REAL_CALLS_ENABLED` debe configurarse solo en el scope Production de Vercel y no debe
llevar prefijo público. Cambiar variables exige un nuevo deployment: la configuración de IA
se cachea en memoria.

## Claves

- `AI_GEMINI_API_KEY`, `AI_GROQ_API_KEY` y `AI_OPENAI_API_KEY`: solo servidor.
- `AI_OPENAI_ENABLED=true` además de la key, porque es el único proveedor de pago.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: la clave de servicio salta RLS por diseño,
  así que nunca puede llegar al navegador ni a un log.

`.env.example` documenta los nombres con valores vacíos. No hay valores reales en el
repositorio y las pruebas usan credenciales ficticias con `fetch` mockeado.

## Higiene de errores

- `AIProviderError.message` es para logs del servidor y no debe contener API keys, tokens,
  prompts ni datos personales.
- `SECURITY_BLOCK` e `INVALID_REQUEST` se convierten en `INTERNAL_ERROR` de cara al cliente:
  no se revela que un filtro de contenido actuó ni por qué.
- Los mensajes públicos son genéricos y en español; el detalle queda en el servidor.
- No se registran prompts completos.

## Fail-closed

Si falta un proveedor con key, si la IP no se puede normalizar, si el rate limit no puede
verificar o si la cuota no se puede confirmar, la respuesta es 503 o 429 —nunca un 200 con
un resultado dudoso—. La preferencia es negar servicio antes que servir sin control.

## Deuda y riesgos

- La `service_role` key otorga acceso total a la base; su rotación y alcance dependen de la
  configuración de Supabase, no del código.
- La falta de verificación de origen en el POST deja la defensa en `SameSite=Lax`.
- Los grants heredados de Supabase (ver [Privilegios y RLS](../base-de-datos/privilegios-y-rls.md))
  son un riesgo de configuración, no de código.

## Related

- [Stack y configuración](../stack/stack-y-configuracion.md) — inventario completo de variables.
- [Privilegios y RLS](../base-de-datos/privilegios-y-rls.md) — por qué la clave de servicio es tan sensible.
- [Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md) — qué revisar en Vercel antes de encender la IA.
