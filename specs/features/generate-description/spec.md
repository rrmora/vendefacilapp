# Especificación funcional — Generar descripción

**Feature:** generate-description
**Fase actual:** Fase 3 (Arquitectura de IA completada, llamadas reales deshabilitadas)
**Contrato público:** `src/types/description.ts`

## 1. Objetivo

Recibir los datos del formulario de cuatro campos y devolver una descripción
comercial en español, lista para copiar a una plataforma de compraventa.

## 2. Alcance (MVP)

- Validación server-side del contrato `IDescriptionRequest`.
- Generación de descripción (MOCK en Fase 1; IA real en Fase 3).
- Respuesta normalizada según `IDescriptionResponse`.
- Errores de validación con código `VALIDATION_ERROR`.

## 3. Reglas de negocio

- `userNotes`: obligatorio, 3–500 caracteres.
- `category`, `condition`, `pricingType`: valores del catálogo definido.
- No confiar en datos del navegador: validar en el servidor con Zod.
- No inventar características, garantías, accesorios, precios ni condiciones.
- El resultado es texto plano copiable (emojis y saltos de línea permitidos).
- Fase 1: el endpoint es MOCK explícito, no llama a proveedores ni consume
  créditos ni cuota.

## 4. Contratos

Ver `src/types/description.ts`:

- `IDescriptionRequest`: category, condition, pricingType, userNotes.
- `IDescriptionResponse`: unión discriminada éxito/error con
  `generatedText`, `tokensUsed`, `errorCode`, `errorMessage`.
- `DescriptionErrorCode`: VALIDATION_ERROR, RATE_LIMITED, PROVIDER_UNAVAILABLE,
  BUDGET_EXCEEDED, INTERNAL_ERROR.

La información de cuota restante se definirá en un contrato adicional antes de
implementar cuotas (Fase 4).

## 5. Casos de uso

### UC-01 Generar descripción (éxito)

1. Usuario completa el formulario y pulsa "Generar descripción con IA".
2. Cliente valida y envía `POST /api/generate`.
3. Servidor valida con Zod.
4. Servicio genera la descripción (MOCK en Fase 1).
5. Servidor responde 200 con `success: true` y `generatedText`.
6. Cliente muestra el resultado y habilita Copiar/Regenerar.

### UC-02 Error de validación

1. Solicitud inválida (campo faltante, userNotes < 3 o > 500, enum inválido).
2. Servidor responde 400 con `success: false`, `errorCode: VALIDATION_ERROR`
   y mensaje comprensible en español.
3. Cliente muestra el mensaje y conserva los datos del formulario.

### UC-03 Método no permitido

`GET /api/generate` responde 405 con el contrato de error.

## 6. Casos límite

- Cuerpo vacío o JSON malformado → 400 VALIDATION_ERROR.
- userNotes exactamente 3 y 500 caracteres → válido.
- userNotes de 2 o 501 caracteres → inválido.
- Valores fuera de catálogo → inválido.
- Campos extra en el body → ignorados (no confiar, no rechazar por ello en MOCK;
  revisar en Fase 4 con política de seguridad).

## 7. Criterios de aceptación (Fase 1)

- [x] `POST /api/generate` válido responde 200 y respeta `IDescriptionResponse`.
- [x] Respuesta MOCK claramente identificable (prefijo `[MOCK]`).
- [x] Validación Zod rechaza los casos inválidos con 400.
- [x] Mensajes de error en español, sin detalles técnicos ni secretos.
- [x] Pruebas unitarias del endpoint pasan con Vitest.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan.

## 8. Estado de Fase 3 — Arquitectura de IA

### 8.1 Adaptadores implementados

| Proveedor | Modelo predeterminado | Estado |
|-----------|----------------------|--------|
| Gemini | gemini-2.5-flash | Implementado, deshabilitado |
| Groq | llama-3.3-70b-versatile | Implementado, deshabilitado; modelo en revisión |
| OpenAI | gpt-4o-mini | Implementado, deshabilitado |

### 8.2 Protecciones activas

- **AI_ENABLED=false** (default): desactiva toda la cadena de IA.
- **realCallsAuthorized=false** (flag interno en código): segunda
  protección independiente. Sin autorización, el endpoint responde
  503 INTERNAL_ERROR sin contactar proveedores.
- Endpoint /api/generate conserva respuesta MOCK cuando AI está deshabilitado.

### 8.3 Contratos públicos

Intactos. IDescriptionRequest/IDescriptionResponse sin cambios.

### 8.4 Pendiente

- Revisión del modelo predeterminado de Groq (llama-3.3-70b-versatile
  en estado "Enterprise" con "Contact Sales"; indicios de deprecación).

## 9. Fuera de alcance en Fase 3

Cuotas, rate limiting, presupuesto (Fase 4), PWA (Fase 5).
