# Knowledge Base Index

> **OKF v0.1 reserved file** — `index.md` carries **no frontmatter** (it is a
> directory listing for progressive disclosure, per the OKF spec). Links are
> standard markdown, relative to this file (`topic/article.md`), NEVER wikilinks.
>
> **Human navigation lives in the `.base` views** (`Articles.base`, `Worklog.base`,
> `Decisions.base`) — live tables over frontmatter, sorted by score/status/date.
> This index is the **machine-readable catalog + fallback** the agent maintains;
> it is not the primary surface a human browses in Obsidian.

## producto

Qué es el producto, cómo se usa y en qué punto del plan está.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Visión y alcance del producto](producto/vision-y-alcance.md) | Promesa, cuatro campos, freemium y lo que queda fuera del MVP. | 2026-10-27 | 6.0 |
| [Flujo de generación y experiencia de usuario](producto/flujo-de-generacion.md) | Estados del formulario, copiar, regenerar y su efecto en la cuota. | 2026-10-27 | 7.0 |
| [Estado y hoja de ruta](producto/estado-y-hoja-de-ruta.md) | Fases cerradas, llamadas reales apagadas y lo que falta para publicar. | 2026-10-27 | 8.0 |

## arquitectura

Cómo se reparte el código y cuál es el contrato entre capas.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Capas y módulos](arquitectura/capas-y-modulos.md) | Presentación, API, aplicación e infraestructura en un solo proceso Next.js. | 2026-10-27 | 5.0 |
| [Contratos y API](arquitectura/contratos-y-api.md) | Entrada, respuesta, códigos públicos, mapeo HTTP y cookie de visitante. | 2026-10-27 | 13.0 |

## stack

Versiones fijadas, scripts y variables de entorno.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Stack y configuración](stack/stack-y-configuracion.md) | Next.js 16, React 19, Tailwind 4, Zod 4 y el inventario de variables. | 2026-10-27 | 7.0 |

## base-de-datos

PostgreSQL como única persistencia: esquema, RPC y privilegios.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Esquema y migraciones](base-de-datos/esquema-y-migraciones.md) | Ocho tablas, sus invariantes y las 26 migraciones por bloques. | 2026-10-27 | 11.0 |
| [RPC y mantenimiento](base-de-datos/rpc-y-mantenimiento.md) | Cuota, presupuesto, rate limit y `run_maintenance` con auditoría. | 2026-10-27 | 13.0 |
| [Privilegios y RLS](base-de-datos/privilegios-y-rls.md) | Cómo 026 deja la base en manos de `service_role` y qué deuda queda. | 2026-10-27 | 13.0 |

## ia

Proveedores, fallback, prompt y control de costes.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Proveedores y fallback](ia/proveedores-y-fallback.md) | Prioridad, errores que reintentan y disposición de cuota. | 2026-10-27 | 9.0 |
| [Prompt y costes](ia/prompt-y-costos.md) | Reglas antiinvención, normalización de tokens y presupuesto del 95 %. | 2026-10-27 | 7.0 |

## seguridad

Qué protege al endpoint y cómo se manejan las credenciales.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Controles antiabuso](seguridad/controles-antiabuso.md) | Rate limit por IP, cuota por visitante y orden de comprobaciones. | 2026-10-27 | 11.0 |
| [Secretos y entornos](seguridad/secretos-y-entornos.md) | Doble interruptor, claves de servidor y errores sin fugas. | 2026-10-27 | 9.0 |

## calidad

Cómo se verifica que lo anterior funciona.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Estrategia de pruebas](calidad/estrategia-de-pruebas.md) | Vitest, integración con PostgreSQL real y ausencia de cobertura/CI. | 2026-10-27 | 7.0 |

## operaciones

Qué hace falta para publicar y qué se sabe roto.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Despliegue y pendientes](operaciones/despliegue-y-pendientes.md) | Checklist de producción, deuda técnica e inconsistencias documentales. | 2026-10-27 | 13.0 |

## sdd

Control de planeación: constitución, decisiones y contexto de sesión.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Constitución](sdd/constitution.md) | Principios no negociables del proyecto (v1.1.0). | 2026-10-27 | — |
| [Decisiones](sdd/decisions.md) | Registro append-only de decisiones significativas. | 2026-10-27 | — |

## harness

Estado del harness `rsc` y del perfil de trabajo.

| Article | Summary | Updated | Score |
|---------|---------|---------|-------|
| [Decisiones del harness](harness/decisions.md) | Decisiones de instalación y configuración del harness. | 2026-10-27 | — |
| [Plan de instalación](harness/installation-plan.md) | Cómo se instaló y qué se aceptó. | 2026-10-27 | — |
| [Perfil del usuario](harness/user-profile.md) | Nivel técnico y preferencias de trato. | 2026-10-27 | — |

> **Score**: composite quality score (inbound links, source count, cited count,
> freshness; minus conflicts and orphan penalty). Regenerated on every
> Maintenance Pass. Articles below the rewrite threshold get picked up by
> Micro-Improve and Deep Improve.
