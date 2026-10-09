import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '../../src/app/api/generate/route';
import {
  areRealCallsAuthorized,
  revokeRealCallsAuthorization,
} from '../../src/lib/ai/descriptionService';
import { resetAIConfigCache } from '../../src/lib/ai/config';

const validBody = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

const ENV_KEYS = ['AI_ENABLED'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetAIConfigCache();
  revokeRealCallsAuthorization();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetAIConfigCache();
  revokeRealCallsAuthorization();
});

function buildRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/generate (MOCK)', () => {
  it('responde 200 con descripción simulada para una solicitud válida', async () => {
    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.tokensUsed).toBeNull();
    expect(data.generatedText).toContain('[MOCK]');
    expect(data.generatedText).toContain(validBody.userNotes);
    expect(data.generatedText).toContain('Electrónica');
    expect(data.generatedText).toContain('Buen estado');
    expect(data.generatedText).toContain('Precio fijo.');
  });

  it('indica precio negociable cuando pricingType es negociable', async () => {
    const response = await POST(
      buildRequest({ ...validBody, pricingType: 'negociable' })
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.generatedText).toContain('Acepto ofertas.');
  });

  it('rechaza userNotes con menos de 3 caracteres', async () => {
    const response = await POST(
      buildRequest({ ...validBody, userNotes: 'ab' })
    );

    expect(response.status).toBe(400);

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('VALIDATION_ERROR');
    expect(data.generatedText).toBe('');
  });

  it('rechaza userNotes con más de 500 caracteres', async () => {
    const response = await POST(
      buildRequest({ ...validBody, userNotes: 'a'.repeat(501) })
    );

    expect(response.status).toBe(400);

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('VALIDATION_ERROR');
  });

  it('acepta userNotes en los límites exactos (3 y 500 caracteres)', async () => {
    const minResponse = await POST(
      buildRequest({ ...validBody, userNotes: 'abc' })
    );
    const maxResponse = await POST(
      buildRequest({ ...validBody, userNotes: 'a'.repeat(500) })
    );

    expect(minResponse.status).toBe(200);
    expect(maxResponse.status).toBe(200);
  });

  it('rechaza categoría fuera del catálogo', async () => {
    const response = await POST(
      buildRequest({ ...validBody, category: 'juguetes' })
    );

    expect(response.status).toBe(400);

    const data = await response.json();

    expect(data.errorCode).toBe('VALIDATION_ERROR');
  });

  it('rechaza estado fuera del catálogo', async () => {
    const response = await POST(
      buildRequest({ ...validBody, condition: 'usado' })
    );

    expect(response.status).toBe(400);
  });

  it('rechaza pricingType inválido', async () => {
    const response = await POST(
      buildRequest({ ...validBody, pricingType: 'gratis' })
    );

    expect(response.status).toBe(400);
  });

  it('rechaza campos faltantes', async () => {
    const response = await POST(buildRequest({ category: 'hogar' }));

    expect(response.status).toBe(400);

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('VALIDATION_ERROR');
    expect(data.errorMessage).toContain('condition');
    expect(data.errorMessage).toContain('pricingType');
    expect(data.errorMessage).toContain('userNotes');
  });

  it('rechaza cuerpo vacío o JSON malformado', async () => {
    const emptyResponse = await POST(buildRequest(''));
    const invalidResponse = await POST(buildRequest('no-es-json'));

    expect(emptyResponse.status).toBe(400);
    expect(invalidResponse.status).toBe(400);
  });
});

describe('GET /api/generate', () => {
  it('responde 405 método no permitido', async () => {
    const response = await GET();

    expect(response.status).toBe(405);

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.generatedText).toBe('');
    expect(data.tokensUsed).toBeNull();
    expect(typeof data.errorMessage).toBe('string');
  });
});

describe('POST /api/generate — Integración AIOrchestrator', () => {
  it('AI_ENABLED=false conserva exactamente el comportamiento MOCK', async () => {
    delete process.env.AI_ENABLED;

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.generatedText).toContain('[MOCK]');
    expect(data.generatedText).toContain('Electrónica');
    expect(data.generatedText).toContain('Buen estado');
    expect(data.generatedText).toContain('Precio fijo.');
    expect(data.tokensUsed).toBeNull();
  });

  it('AI_ENABLED=true sin autorización de ejecución real devuelve error controlado', async () => {
    process.env.AI_ENABLED = 'true';
    expect(areRealCallsAuthorized()).toBe(false);

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(503);

    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('INTERNAL_ERROR');
    expect(data.generatedText).toBe('');
    expect(data.tokensUsed).toBeNull();
  });

  it('no permite activar llamadas externas solo con variables de entorno', async () => {
    process.env.AI_ENABLED = 'true';

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(503);

    const data = await response.json();
    expect(data.success).toBe(false);
  });

  it('valida solicitudes inválidas antes de ejecutar generación', async () => {
    process.env.AI_ENABLED = 'true';

    const response = await POST(
      buildRequest({ ...validBody, userNotes: 'ab' })
    );

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.errorCode).toBe('VALIDATION_ERROR');
  });

  it('no expone información sensible en respuestas de error', async () => {
    process.env.AI_ENABLED = 'true';

    const response = await POST(buildRequest(validBody));
    const data = await response.json();
    const serialized = JSON.stringify(data);

    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('secret');
    expect(data.errorMessage).not.toContain('AI_ENABLED');
    expect(data.errorMessage).not.toContain('realCallsAuthorized');
  });

  it('contratos públicos sin cambios en respuesta exitosa', async () => {
    const response = await POST(buildRequest(validBody));
    const data = await response.json();

    expect(data).toHaveProperty('success');
    expect(data).toHaveProperty('generatedText');
    expect(data).toHaveProperty('tokensUsed');
    expect(data.success).toBe(true);
    expect(typeof data.generatedText).toBe('string');
    expect(data.tokensUsed).toBeNull();
  });

  it('contratos públicos sin cambios en respuesta de error', async () => {
    const response = await POST(buildRequest({ category: 'hogar' }));
    const data = await response.json();

    expect(data).toHaveProperty('success');
    expect(data).toHaveProperty('generatedText');
    expect(data).toHaveProperty('tokensUsed');
    expect(data).toHaveProperty('errorCode');
    expect(data).toHaveProperty('errorMessage');
    expect(data.success).toBe(false);
    expect(data.generatedText).toBe('');
    expect(data.tokensUsed).toBeNull();
    expect(data.errorCode).toBe('VALIDATION_ERROR');
    expect(typeof data.errorMessage).toBe('string');
  });
});
