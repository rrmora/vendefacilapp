# PRD — VendeFácil AI (`vendefacil-pwa`)

**Versión:** MVP (Fase 1–6)
**Producto:** Generador de descripciones comerciales con IA para vendedores.
**Plataformas objetivo del usuario:** Facebook Marketplace, eBay, bazares digitales,
grupos de compraventa y otros mercados en línea.

## 1. Objetivo

Permitir que cualquier vendedor genere una descripción atractiva, lista para
publicar, en pocos segundos y con el mínimo esfuerzo.

## 2. Principios de experiencia de usuario

1. Mobile First.
2. Simplicidad: formulario de exactamente cuatro campos.
3. Rapidez: catálogos y opciones seleccionables.
4. Mínima escritura: un solo campo de texto libre.
5. Sin registro obligatorio en el MVP.
6. Resultados inmediatos con estados claros (carga, éxito, error).
7. Interfaz en español.

## 3. Modelo comercial

**Freemium.**

### MVP

- Uso gratuito sin registro.
- Generaciones limitadas por visitante (inicial: 5 por día).
- Publicidad no intrusiva para visitantes gratuitos (RF-008; integración real en Fase 6).
- Sin historial, suscripciones ni pasarela de pagos.

### Futuro (NO implementar en MVP)

Registro opcional, historial, planes premium, pagos, análisis de fotografías,
descripciones especializadas por plataforma.

## 4. Alcance funcional del MVP

1. Formulario simplificado de generación.
2. Generación de descripciones mediante IA.
3. Copiar descripción.
4. Regenerar descripción.
5. Control de generaciones gratuitas.
6. Múltiples proveedores de IA con fallback automático controlado.
7. Control de costos de proveedores.
8. Interfaz responsive.
9. PWA instalable.
10. Manejo de errores y estados de carga.
11. Pruebas automatizadas.
12. Protección contra abuso.

## 5. Formulario principal (cuatro campos)

### Campo 1 — Categoría (catálogo desplegable)

Opciones visibles: Ropa y accesorios, Electrónica, Hogar, Vehículos, Otros.

```typescript
type ProductCategory =
  | 'ropa' | 'electronica' | 'hogar' | 'vehiculos' | 'otros';
```

### Campo 2 — Estado del producto (selector rápido)

Opciones: Nuevo, Como nuevo, Buen estado, Con detalles de uso.
Valor predeterminado: `buen_estado`.

```typescript
type ProductCondition =
  | 'nuevo' | 'como_nuevo' | 'buen_estado' | 'detalles_uso';
```

### Campo 3 — ¿Qué estás vendiendo? (textarea)

- Obligatorio, mínimo 3 caracteres, máximo 500.
- Contador de caracteres visible.
- Nombre, marca, modelo, precio y características van en el mismo campo
  (no se crean campos independientes).

### Campo 4 — Acepto ofertas (precio negociable) (checkbox)

- Marcado: `negociable`. Desmarcado: `fijo`. Predeterminado: desmarcado.
- No se solicita precio numérico obligatorio.

### Acción principal

Botón **Generar descripción con IA**: valida, muestra carga, deshabilita
solicitudes duplicadas, envía al backend y muestra resultado o error.

## 6. Generación de descripciones

La descripción deberá: estar en español, ser fácil de leer, usar emojis con
moderación, ser reutilizable en plataformas, mantener tono natural y **no
inventar** características, garantías, accesorios, precios ni condiciones.

- Información insuficiente: generar solo con los datos disponibles; no inventar.
- Durante la generación: indicador de carga, botón deshabilitado, mensaje
  accesible.
- Errores: mensaje comprensible, sin detalles técnicos, permitir reintento,
  conservar datos introducidos, no descontar cuota por solicitudes fallidas.

## 7. Acciones sobre el resultado

### Copiar descripción

Copia completa como texto plano (conserva emojis y saltos de línea), confirma
con "¡Descripción copiada!", no consume cuota, permite copia manual si falla el
portapapeles, solo habilitado con resultado válido.

### Regenerar descripción

Usa los mismos datos de la última solicitud exitosa, solicita una variante,
consume una unidad de cuota por éxito, muestra carga, bloquea solicitudes
simultáneas, conserva el resultado anterior y solo lo reemplaza si la nueva
generación es exitosa. Bloqueada sin cuota disponible.

## 8. Control de generaciones gratuitas

- Límite configurable (inicial: 5 por día por visitante), no hardcodeado.
- Generar y Regenerar consumen una unidad solo cuando son exitosos.
- Copiar no consume. Fallos no consumen.
- No permitir superar el límite con solicitudes concurrentes.
- Mostrar generaciones restantes y mensaje al agotarse.
- Sin autenticación para la cuota gratuita.
- Controles razonables del lado del servidor; no depender exclusivamente de
  identificadores controlados por el cliente.
- Reservas de cuota atómicas, liberadas si la operación falla.
- **Por definir antes de implementar:** definición de visitante, zona horaria
  y reinicio de cuota.

## 9. Stack tecnológico

Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS.
Validación: Zod. Backend: Next.js Route Handlers (Node runtime).
IA: adaptadores para Gemini, Groq (Llama) y OpenAI; modelos configurables.
Persistencia operativa: Supabase PostgreSQL (contadores, presupuesto, métricas).
PWA: evaluar Serwist. Testing: Vitest + Playwright.
Herramientas: pnpm, ESLint, Git, GitHub, GitHub Actions.
Hosting: pendiente de definición.

## 10. Arquitectura

- **Presentation Layer:** componentes React, formulario, estados, resultados.
- **API Layer:** Route Handlers, validación de contratos, rate limiting,
  normalización de respuestas, errores.
- **Application Layer:** casos de uso, orquestación de proveedores, fallback,
  cuotas, presupuesto.
- **Infrastructure Layer:** clientes de IA, persistencia, logs, métricas.

Sin microservicios. Sin sobreingeniería.

## 11. Proveedores de IA

Orden inicial: Gemini Flash → Llama (Groq) → modelo económico de OpenAI.
Interfaz interna `IAIProvider` por adaptador (auth, request, response, errores,
tokens).

Política de fallback: rate limit/cuota agotada/timeout/500-503 → fallback;
solicitud inválida → sin fallback; credenciales inválidas → incidente, sin
reintento en el mismo proveedor; presupuesto agotado → no usar proveedor de
pago; todos fallaron → error controlado. Sin fallback silencioso.

Presupuesto mensual configurable (inicial: US$5) para el proveedor de pago,
con reservas conservadoras y control de concurrencia. No prometer límite
financiero absoluto si el proveedor no lo garantiza.

## 12. Seguridad

Validación server-side, protección de API keys, variables de entorno, rate
limiting, protección contra abuso, control de costos, manejo seguro de errores,
límites de entrada, sanitización según contexto de salida, protección contra
prompt injection (las notas del usuario son datos no confiables), sin logs de
prompts completos, sin datos personales innecesarios, sin almacenamiento
exclusivamente en memoria para cuotas de producción serverless, sin claves de
IA en variables públicas de Next.js.

## 13. Requisitos PWA

Web App Manifest, iconos, Service Worker, diseño responsive, estrategias de
caché por tipo de recurso, manejo de conexión offline, experiencia de
instalación. La generación requiere Internet (no prometer generación offline),
sin caché pública de respuestas privadas de IA, mensaje sin conexión.

## 14. Plan de desarrollo

- **Fase 1 — Scaffolding:** inicialización, TS, Tailwind, estructura, contexto,
  PRD, contratos, API mock, pruebas iniciales.
- **Fase 2 — UI Mobile First:** formulario de cuatro campos, validaciones,
  skeleton loader, resultado simulado, copiar, regenerar con mock, errores.
  Considerar la ubicación futura de anuncios en el diseño (RF-008), sin
  integrar SDKs ni scripts.
- **Fase 3 — Integración de IA:** adaptadores, proveedores, orquestador,
  fallback, prompts, normalización.
- **Fase 4 — Seguridad y cuotas:** persistencia operativa, rate limiting, cuotas,
  presupuesto, protección contra abuso, pruebas de concurrencia.
  La IA no se habilita públicamente hasta completar estos controles.
- **Fase 5 — PWA y calidad:** manifest, service worker, offline, accesibilidad,
  E2E, optimización.
- **Fase 6 — Preparación comercial:** observabilidad, CI, revisión de seguridad,
  selección de hosting, despliegue del MVP. Evaluar proveedores de publicidad
  e integrar si cumplen sus requisitos (RF-008).

## 15. Monetización mediante publicidad (RF-008)

**Objetivo:** mostrar anuncios a visitantes de la versión gratuita sin afectar negativamente la experiencia principal de generación de descripciones.

### Requisitos funcionales

- Espacios publicitarios responsivos.
- Anuncios visualmente identificados como publicidad.
- La publicidad no bloquea el formulario ni las acciones de generación, copia o regeneración.
- Sin anuncios emergentes ni intersticiales en el MVP.
- Integración modular y configurable; posible habilitar o deshabilitar anuncios sin modificar la lógica de generación.
- Arquitectura preparada para ocultar anuncios a usuarios Premium en versiones posteriores.

### Requisitos técnicos

- Componente reutilizable `AdSlot` cuando se implemente la funcionalidad.
- Carga diferida cuando sea apropiado.
- Reservar espacio para reducir cambios inesperados en el diseño (CLS).
- Evitar cargar scripts publicitarios innecesarios.
- No exponer datos privados de usuarios a proveedores publicitarios.
- Cumplir los requisitos de consentimiento, privacidad y políticas del proveedor seleccionado.
- No simular impresiones ni clics publicitarios.

### Alcance por fases

- **Fase 2 — UI Mobile First:** considerar la ubicación futura de anuncios en el diseño; no integrar SDKs ni scripts publicitarios.
- **Fase 6 — Preparación comercial:** evaluar proveedores de publicidad, integrar si se cumplen sus requisitos, verificar rendimiento, accesibilidad y experiencia móvil, y configurar consentimiento y privacidad cuando corresponda.

### Criterios de aceptación

1. La interfaz funciona correctamente con publicidad habilitada o deshabilitada.
2. El anuncio no interfiere con las acciones principales.
3. La ubicación publicitaria es responsive.
4. No se producen desplazamientos de diseño significativos.
5. No se cargan scripts publicitarios sin cumplir los requisitos de consentimiento aplicables.
