---
type: article
title: Visión y alcance del producto
description: Qué es VendeFácil AI, para quién, qué promete el MVP y qué queda explícitamente fuera.
resource: specs/product/PRD.md
tags: [producto, mvp, freemium]
timestamp: 2026-10-27T21:40:00-06:00
aliases: [vision-y-alcance]
topic: producto
status: stable
sources: ["[PRD — VendeFácil AI](../../raw/producto/prd-vendefacil.md)"]
score: 6
---

# Visión y alcance del producto

> Sources: VendeFácil AI, PRD MVP (sin fecha; snapshot 2026-10-27)
> Raw: [prd-vendefacil](../../raw/producto/prd-vendefacil.md)

## Overview

VendeFácil AI es un generador de descripciones comerciales con IA para vendedores
particulares que publican en Facebook Marketplace, eBay, bazares digitales y grupos de
compraventa. El MVP apunta a una sola promesa: convertir cuatro datos en una descripción
lista para publicar en pocos segundos, sin registro y sin fricción. Todo lo demás —
historial, planes, fotos, pagos— está deliberadamente fuera de alcance.

## El problema y la promesa

El usuario objetivo vende de forma ocasional y escribe descripciones apresuradas, repetitivas
o incompletas. La interfaz debe ser mobile-first, con catálogos seleccionables y un único
campo de texto libre; la promesa es rapidez y mínima escritura, no control fino ni edición
avanzada.

Siete principios de experiencia gobiernan el producto: mobile first, simplicidad (cuatro
campos exactos), rapidez (opciones seleccionables), mínima escritura (un solo campo libre),
sin registro obligatorio, resultados inmediatos con estados claros, e interfaz en español.

## Modelo comercial

Freemium sin pasarela de pagos en el MVP: uso gratuito sin registro con un límite de
generaciones por visitante (inicialmente 5 por día), publicidad no intrusiva prevista para
la Fase 6, y sin historial ni suscripciones. El registro opcional, los planes premium, el
análisis de fotografías y las descripciones especializadas por plataforma son futuro
explícito y **no** deben implementarse en esta etapa.

## Alcance funcional del MVP

1. Formulario simplificado de generación.
2. Generación de descripciones mediante IA.
3. Copiar descripción.
4. Regenerar descripción.
5. Control de generaciones gratuitas.
6. Varios proveedores de IA con fallback automático controlado.
7. Control de costos de proveedores.
8. Interfaz responsive.
9. PWA instalable.
10. Manejo de errores y estados de carga.
11. Pruebas automatizadas.
12. Protección contra abuso.

El formulario se limita a categoría (ropa, electrónica, hogar, vehículos, otros), estado
(nuevo, como nuevo, buen estado, con detalles de uso; por defecto buen estado), un textarea
de 3–500 caracteres que concentra nombre, marca, modelo, precio y características, y un
checkbox de precio negociable que se traduce a `negociable` o `fijo`.

## Lo que la descripción debe y no debe hacer

La salida debe estar en español, ser fácil de leer, usar emojis con moderación, servir en
varias plataformas y mantener un tono natural. La restricción dura: **no inventar**
características, garantías, accesorios, precios ni condiciones. Con información insuficiente
se genera solo con los datos disponibles. Un fallo nunca descuenta cuota y conserva lo que
el usuario escribió.

## Fuera de alcance hoy

Registro obligatorio, historial, planes premium, pagos, análisis de imágenes, variantes por
plataforma y generación offline. La PWA y la publicidad son parte del plan pero pertenecen a
fases posteriores; el estado real de cada fase se sigue en
[Estado y hoja de ruta](./estado-y-hoja-de-ruta.md).

## Related

- [Flujo de generación](./flujo-de-generacion.md) — cómo se convierten estos principios en pantalla y estados.
- [Contratos y API](../arquitectura/contratos-y-api.md) — el contrato que materializa el alcance.
- [Constitución SDD](../sdd/constitution.md) — los principios no negociables que acotan cambios.
