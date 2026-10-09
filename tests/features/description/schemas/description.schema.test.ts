import { describe, expect, it } from 'vitest';
import {
  descriptionRequestSchema,
  PRODUCT_CATEGORIES,
  PRODUCT_CONDITIONS,
  PRICING_TYPES,
} from '@/features/description/schemas/description.schema';

const validRequest = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

describe('descriptionRequestSchema', () => {
  it('valida una solicitud correcta', () => {
    const result = descriptionRequestSchema.safeParse(validRequest);

    expect(result.success).toBe(true);
  });

  it('rechaza userNotes con menos de 3 caracteres', () => {
    const result = descriptionRequestSchema.safeParse({
      ...validRequest,
      userNotes: 'ab',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza userNotes con más de 500 caracteres', () => {
    const result = descriptionRequestSchema.safeParse({
      ...validRequest,
      userNotes: 'a'.repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it('acepta userNotes en los límites exactos (3 y 500 caracteres)', () => {
    const minResult = descriptionRequestSchema.safeParse({
      ...validRequest,
      userNotes: 'abc',
    });
    const maxResult = descriptionRequestSchema.safeParse({
      ...validRequest,
      userNotes: 'a'.repeat(500),
    });

    expect(minResult.success).toBe(true);
    expect(maxResult.success).toBe(true);
  });

  it('rechaza valores fuera de los catálogos', () => {
    const categoryResult = descriptionRequestSchema.safeParse({
      ...validRequest,
      category: 'juguetes',
    });
    const conditionResult = descriptionRequestSchema.safeParse({
      ...validRequest,
      condition: 'usado',
    });
    const pricingResult = descriptionRequestSchema.safeParse({
      ...validRequest,
      pricingType: 'gratis',
    });

    expect(categoryResult.success).toBe(false);
    expect(conditionResult.success).toBe(false);
    expect(pricingResult.success).toBe(false);
  });

  it('rechaza solicitudes incompletas', () => {
    const result = descriptionRequestSchema.safeParse({
      category: 'hogar',
    });

    expect(result.success).toBe(false);
  });

  it('expone los catálogos esperados', () => {
    expect(PRODUCT_CATEGORIES).toHaveLength(5);
    expect(PRODUCT_CONDITIONS).toHaveLength(4);
    expect(PRICING_TYPES).toEqual(['fijo', 'negociable']);
  });
});
