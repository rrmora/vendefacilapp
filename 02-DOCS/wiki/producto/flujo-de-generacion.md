---
type: article
title: Flujo de generación y experiencia de usuario
description: Recorrido del formulario de cuatro campos, sus estados, la copia y la regeneración tal como están implementados.
resource: src/components/description/DescriptionForm.tsx
tags: [producto, ux, formulario, estados]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [flujo-de-generacion]
topic: producto
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)", "[Especificación generate-description](../../raw/producto/spec-generate-description.md)"]
score: 7
---

# Flujo de generación y experiencia de usuario

> Sources: VendeFácil AI, PRD MVP (sin fecha); Especificación generate-description (sin fecha)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md); [spec-generate-description](../../raw/producto/spec-generate-description.md)

## Overview

El flujo tiene un camino feliz corto y un conjunto de estados explícitos: validación local,
envío único, carga accesible, resultado copiable y regeneración que conserva el texto
anterior hasta que la nueva generación tiene éxito. Cada acción tiene un efecto distinto
sobre la cuota, y esa distinción es parte del contrato de producto.

## Anatomía de la pantalla

La UI se compone de piezas pequeñas bajo `src/components/description/`:
`CategorySelect`, `ConditionSelector`, `ProductNotesField`, `NegotiablePriceField`,
`DescriptionForm` como orquestador y `DescriptionResult` para el resultado. El estilo usa
Tailwind 4 y un componente compartido `src/components/ui/field.tsx`.

El textarea es el único campo libre y muestra contador de caracteres. La validación de
cliente replica el esquema del servidor: 3–500 caracteres tras recortar espacios y valores
dentro del catálogo. Los campos adicionales del body se ignoran.

## Secuencia de una generación

1. El usuario completa los cuatro campos y pulsa **Generar descripción con IA**.
2. El cliente valida y envía `POST /api/generate`; el botón se deshabilita para impedir
   envíos duplicados.
3. Mientras espera, se muestra un indicador de carga con mensaje accesible.
4. Con 200, se renderiza el texto y se habilitan **Copiar** y **Regenerar**.
5. Con error, se muestra un mensaje comprensible en español, sin detalles técnicos, y se
   conservan los datos introducidos para reintentar.

Un `GET /api/generate` responde 405 y también se presenta como error controlado, nunca como
pantalla rota.

## Copiar

Copia el texto completo como texto plano, conservando emojis y saltos de línea, y confirma
con «¡Descripción copiada!». No consume cuota. Si el portapapeles falla, el texto sigue
visible para copia manual. La acción solo existe cuando hay un resultado válido.

## Regenerar

Reutiliza los datos de la última solicitud exitosa y pide una variante. Consume una unidad
de cuota **solo si la nueva generación tiene éxito**, bloquea solicitudes simultáneas y
mantiene el resultado anterior en pantalla: el texto previo solo se reemplaza cuando llega
uno nuevo válido. Sin cuota disponible, la acción se bloquea con un mensaje claro.

> Nota de implementación: el servicio fija `variant: 0` al construir la petición, de modo
> que hoy la variación de prompt existe en la capa de IA pero no se activa desde la UI.

## Cuota visible y errores

El producto exige mostrar generaciones restantes y avisar al agotarse. Los fallos no
descuentan; los éxitos sí. El contrato HTTP distingue 402 (presupuesto), 429 (rate limit o
cuota) y 503 (servicio no disponible), y la UI traduce cada uno a un mensaje accionable en
lugar de exponer códigos.

## Related

- [Visión y alcance del producto](./vision-y-alcance.md) — las reglas de producto detrás de cada estado.
- [Contratos y API](../arquitectura/contratos-y-api.md) — códigos y forma de la respuesta.
- [Controles antiabuso](../seguridad/controles-antiabuso.md) — por qué la cuota se reserva y se libera.
