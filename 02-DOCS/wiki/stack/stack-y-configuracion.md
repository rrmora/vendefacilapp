---
type: article
title: Stack y configuración
description: Versiones fijadas, scripts de trabajo y el inventario completo de variables de entorno que gobiernan el sistema.
resource: package.json
tags: [stack, configuracion, entorno, nextjs]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [stack-y-configuracion]
topic: stack
status: stable
sources: ["[Constitución SDD](../../raw/meta/constitucion-sdd.md)", "[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)"]
score: 7
---

# Stack y configuración

> Sources: vende-facil-app, Constitución SDD v1.1.0 (2026-10-27); PRD MVP (sin fecha)
> Raw: [constitucion-sdd](../../raw/meta/constitucion-sdd.md); [prd-vendefacil](../../raw/producto/prd-vendefacil.md)

## Overview

El stack está fijado por la constitución: Node.js 24, TypeScript 5.9 en `strict`, pnpm 12
con un único lockfile, Next.js 16 App Router, React 19, Tailwind 4, Zod 4 y Supabase como
única persistencia. Cambiar el gestor de paquetes es una enmienda menor; cambiar un
framework es una enmienda mayor.

## Versiones y piezas

| Pieza | Versión / forma |
|-------|-----------------|
| Next.js | 16.4.0 (App Router, Route Handlers en Node runtime) |
| React | 19.3.0 |
| TypeScript | 5.9, `strict` |
| Tailwind | 4, vía `@tailwindcss/turbopack` (sin `tailwind.config`) |
| Zod | 4.6.5 |
| Vitest | 5.0.3 + happy-dom + Testing Library |
| Supabase JS | 2.117.x |
| pnpm | 12.4.2 |
| Node | 24 |

No hay SDK de proveedores de IA: los tres adaptadores usan `fetch` nativo. No hay
Playwright, ni generador de PWA, ni framework de componentes externo.

## Scripts

| Script | Qué hace |
|--------|----------|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` | Build de producción |
| `pnpm start` | Sirve el build |
| `pnpm lint` | ESLint 9 con `eslint-config-next` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` (unitarias + integración) |

La constitución exige lint y typecheck sin errores ni warnings antes de mergear. No hay
script de cobertura ni de E2E.

## Variables de entorno

**Interruptores de IA**

- `AI_ENABLED` (default `false`): sirve MOCK y no toca Supabase ni proveedores.
- `AI_REAL_CALLS_ENABLED` (default `false`): segunda barrera; sin ella el flujo real
  responde 503.
- `AI_GLOBAL_TIMEOUT_MS` (default 25000).

**Proveedores** (patrón `AI_<PROVEEDOR>_*`)

- `AI_GEMINI_API_KEY`, `AI_GEMINI_ENABLED`, `AI_GEMINI_MODEL`, `AI_GEMINI_PRIORITY`,
  `AI_GEMINI_TIMEOUT_MS`.
- `AI_GROQ_*` con la misma forma.
- `AI_OPENAI_*` con la misma forma; OpenAI es el único proveedor de pago y exige
  `AI_OPENAI_ENABLED=true` además de la key.

Gemini y Groq se habilitan solos si hay key y no hay un `_ENABLED` explícito. Si falta la
key, el proveedor queda deshabilitado aunque `_ENABLED` sea `true`.

**Límites y presupuesto**

- `AI_MONTHLY_BUDGET_USD` (default 5).
- `AI_MAX_TOKENS_DEFAULT_INPUT` (default 400) y `AI_MAX_TOKENS_DEFAULT_OUTPUT` (default
  200), usados cuando el proveedor no reporta tokens.

**Persistencia y red**

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (solo servidor).
- `TRUST_PROXY` o `TRUSTED_PROXIES` (`true` o `1`) para aceptar cabeceras de proxy al
  extraer la IP.
- `NODE_ENV` decide el flag `secure` de la cookie.

`.env.example` documenta todos los nombres sin valores reales. Ninguna clave debe llevar
prefijo `NEXT_PUBLIC_`.

## Advertencias del stack

Next.js 16 difiere de versiones anteriores; el `AGENTS.md` obliga a leer las guías en
`node_modules/next/dist/docs/` antes de escribir código nuevo. Tailwind 4 con Turbopack no
usa archivo de configuración, lo que rompe recetas de v3. La configuración de IA se cachea
en memoria, así que cambiarla exige reiniciar el proceso.

## Related

- [Contratos y API](../arquitectura/contratos-y-api.md) — el contrato que estas piezas sirven.
- [Secretos y entornos](../seguridad/secretos-y-entornos.md) — cómo se manejan las variables sensibles.
- [Despliegue y pendientes](../operaciones/despliegue-y-pendientes.md) — qué configuración exige producción.
