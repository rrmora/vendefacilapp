import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDescription } from '@/features/description/services/descriptionApi';
import type { IDescriptionRequest } from '@/types/description';

const request: IDescriptionRequest = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateDescription', () => {
  it('envía la solicitud al endpoint y devuelve la descripción', async () => {
    const body = {
      success: true,
      generatedText: '[MOCK] Descripción de prueba',
      tokensUsed: null,
    };
    fetchMock.mockResolvedValue(Response.json(body));

    const response = await generateDescription(request);

    expect(response).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
    );
  });

  it('propaga los errores de validación del servidor', async () => {
    const body = {
      success: false,
      generatedText: '',
      tokensUsed: null,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Revisa los siguientes campos: userNotes.',
    };
    fetchMock.mockResolvedValue(Response.json(body, { status: 400 }));

    const response = await generateDescription(request);

    expect(response.success).toBe(false);

    if (response.success) {
      throw new Error('Se esperaba una respuesta de error');
    }

    expect(response.errorCode).toBe('VALIDATION_ERROR');
  });

  it('devuelve un error amigable cuando falla la red', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    const response = await generateDescription(request);

    expect(response.success).toBe(false);

    if (response.success) {
      throw new Error('Se esperaba una respuesta de error');
    }

    expect(response.errorCode).toBe('INTERNAL_ERROR');
    expect(response.errorMessage).toContain('conexión');
  });
});
