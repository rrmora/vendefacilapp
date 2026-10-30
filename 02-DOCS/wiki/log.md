# Wiki Log

## [2026-10-30] sync | Alineación documental con el repositorio (commit 78797cd)
- Updated: [Estado y hoja de ruta](producto/estado-y-hoja-de-ruta.md), [Privilegios y RLS](base-de-datos/privilegios-y-rls.md), [Estrategia de pruebas](calidad/estrategia-de-pruebas.md), [Despliegue y pendientes](operaciones/despliegue-y-pendientes.md).
- Corrected: 026 committeada en `6fb3c04` y en `origin/master`; T-004-8.5/8.5b ya no están "sin commit"; B-02 abierta con prueba de detección en `9abf528`.
- Added: [Pendientes de trabajo 2026-10-30](reports/pendientes-2026-10-30.md).
- Verified gates: typecheck y build pasan; `pnpm lint` falla por archivos del harness; 8 suites de integración requieren Docker.

## [2026-10-27] maintenance | autofixes: 0, new See Also: 0, gaps detected: 4
- Scores recomputed for 15 articles; `scores.json` regenerated.
- Cross-link sweep: every compiled article already carries `## Related`.

## [2026-10-27] ingest | Bootstrap documental del proyecto (7 fuentes)
- Created: [Visión y alcance del producto](producto/vision-y-alcance.md)
- Created: [Flujo de generación y experiencia de usuario](producto/flujo-de-generacion.md)
- Created: [Estado y hoja de ruta](producto/estado-y-hoja-de-ruta.md)
- Created: [Capas y módulos](arquitectura/capas-y-modulos.md)
- Created: [Contratos y API](arquitectura/contratos-y-api.md)
- Created: [Stack y configuración](stack/stack-y-configuracion.md)
- Created: [Esquema y migraciones](base-de-datos/esquema-y-migraciones.md)
- Created: [RPC y mantenimiento](base-de-datos/rpc-y-mantenimiento.md)
- Created: [Privilegios y RLS](base-de-datos/privilegios-y-rls.md)
- Created: [Proveedores y fallback](ia/proveedores-y-fallback.md)
- Created: [Prompt y costos](ia/prompt-y-costos.md)
- Created: [Controles antiabuso](seguridad/controles-antiabuso.md)
- Created: [Secretos y entornos](seguridad/secretos-y-entornos.md)
- Created: [Estrategia de pruebas](calidad/estrategia-de-pruebas.md)
- Created: [Despliegue y pendientes](operaciones/despliegue-y-pendientes.md)
- Sources: `specs/product/PRD.md`, `specs/features/generate-description/{spec,plan,tasks,spec-t004}.md`, `MEMORY.md`, `CONSTITUTION.md`.
- Refused by hash guard (not ingested): `README.md`, `AGENTS.md` — project files the assistant relies on.
