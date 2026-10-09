import { z } from 'zod';

export const PRODUCT_CATEGORIES = [
  'ropa',
  'electronica',
  'hogar',
  'vehiculos',
  'otros',
] as const;

export const PRODUCT_CONDITIONS = [
  'nuevo',
  'como_nuevo',
  'buen_estado',
  'detalles_uso',
] as const;

export const PRICING_TYPES = ['fijo', 'negociable'] as const;

export const descriptionRequestSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES),
  condition: z.enum(PRODUCT_CONDITIONS),
  pricingType: z.enum(PRICING_TYPES),
  userNotes: z.string().min(3).max(500),
});
