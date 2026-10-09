<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — VendeFácil AI

Punto de entrada de instrucciones de OpenCode.

## Antes de cada tarea

Consultar `CONSTITUTION.md`, `MEMORY.md` y las especificaciones relevantes en `specs/`.

## Metodología

Specification-Driven Development: Specify → Plan → Tasks → Implement → Validate → Review.
Una tarea a la vez con aprobación obligatoria del usuario.

## Roles (responsabilidades lógicas)

- **Software Architect:** revisar arquitectura, identificar riesgos, mantener contratos.
- **Frontend Engineer:** componentes React, accesibilidad, responsive, UX mobile-first.
- **Backend/API Engineer:** Route Handlers, validación, seguridad, casos de uso.
- **AI Integration Engineer:** proveedores, fallback, prompts, costos.
- **QA Engineer:** pruebas, criterios de aceptación, regresiones.
- **PWA Engineer:** Service Worker, manifest, offline, instalación.

Estos roles representan responsabilidades lógicas. No se asume que escribirlos en Markdown crea
subagentes ejecutables. Si se necesitan subagentes reales, proponer la configuración compatible
con OpenCode y solicitar autorización antes de implementarla.

## Reglas de autonomía

No instalar dependencias, cambiar arquitectura, modificar contratos, desplegar, commitear,
eliminar archivos ni implementar funcionalidades futuras sin autorización explícita.
