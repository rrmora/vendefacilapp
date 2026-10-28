# Decisiones — SDD

Registro append-only de las decisiones significativas del proyecto. Formato: fecha, decisión,
opciones consideradas y por qué.

| Fecha | Decisión | Opciones consideradas | Por qué |
|-------|----------|-----------------------|---------|
| 2026-10-27 | Ratificar la constitución SDD v1.0.0 con 25 principios | (a) constitución SDD como fuente única; (b) `CONSTITUTION.md` raíz como fuente y la SDD como referencia | Una sola fuente evita deriva entre dos documentos de reglas. La raíz queda como puntero. |
| 2026-10-27 | Barras de calidad: `lint` + `typecheck` limpias, `pnpm test` verde con 0 omitidas y prueba por comportamiento nuevo; sin umbral numérico de cobertura todavía | (a) suite verde + prueba por feature; (b) ≥80% de cobertura en código cambiado; (c) solo suite verde | Vitest no mide cobertura hoy; fijar un umbral sin medirlo sería una regla no verificable. Se puede endurecer por enmienda al configurar `coverage`. |
| 2026-10-27 | Accesibilidad mínima WCAG 2.1 AA | (a) WCAG 2.1 AA; (b) mobile-first básico; (c) sin barra formal | La PWA es mobile-first y de uso público; AA es verificable (teclado, foco, contraste, etiquetas). |
| 2026-10-27 | Presupuesto de rendimiento: LCP ≤ 2.5 s en móvil 4G y p95 de API ≤ 1 s sin contar la IA | (a) LCP 2.5 s + p95 1 s; (b) medir sin umbral; (c) sin presupuesto | Números nombrados y medibles; el tiempo de proveedor de IA se excluye porque su latencia no la controla el proyecto. |
| 2026-10-27 | Commits con Conventional Commits en español, sin gitmoji; autoría humana | (a) Conventional Commits; (b) gitmoji + Conventional; (c) sin formato | Es lo que ya usa el historial (39 commits), no requiere instalar el guard de gitmoji y mantiene consistencia. |
| 2026-10-27 | Instalar rsc-harness con workflow `branches + PR` para `opencode` | (a) ramas + PR; (b) directo en `main` | El proyecto ya tiene trabajo sensible (migraciones, privilegios, IA) y commits locales sin push; PR da revisión antes de fusionar. |
| 2026-10-27 | Enmienda v1.1.0: añadir el principio 26 contra la sobreingeniería | (a) recuperar la regla 5 original como principio comprobable; (b) dejarla como preferencia no vinculante | La consolidación v1.0.0 la había perdido; se restaura sin reenumerar para no invalidar citas existentes. |
| 2026-10-27 | Permisos git de OpenCode en `ask` y force-push en `deny` | (a) `ask` para commit/push/PR; (b) `allow` de rsc; (c) `off` sin reglas | El principio 12 exige autorización explícita y `opencode 1.18` ejecuta sin preguntar cuando ninguna regla coincide; `off` a secas era más permisivo, no más seguro. |
