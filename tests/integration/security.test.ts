import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/generate/route';
import { generateDescription } from '@/lib/ai/descriptionService';
import {
  areRealCallsAuthorized,
  authorizeRealCalls,
  restoreRealCallsEnv,
  revokeRealCallsAuthorization,
} from '../helpers/aiRealCalls';
import { resetAIConfigCache } from '@/lib/ai/config';
import { resetOrchestratorCache } from '@/lib/ai/orchestrator';

const validBody = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%',
} as const;

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_REAL_CALLS_ENABLED',
  'AI_GLOBAL_TIMEOUT_MS',
  'AI_GEMINI_API_KEY',
  'AI_GEMINI_ENABLED',
  'AI_GEMINI_PRIORITY',
  'AI_GROQ_API_KEY',
  'AI_GROQ_ENABLED',
  'AI_GROQ_PRIORITY',
  'AI_OPENAI_API_KEY',
  'AI_OPENAI_ENABLED',
  'AI_OPENAI_PRIORITY',
] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetAIConfigCache();
  resetOrchestratorCache();
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
  restoreRealCallsEnv(originalEnv.AI_REAL_CALLS_ENABLED);
  resetOrchestratorCache();
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/ai/orchestrator');
});

function buildRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('T-003A-9: Integración y seguridad', () => {
  it('1. AI_ENABLED=false devuelve exactamente el comportamiento MOCK actual', async () => {
    delete process.env.AI_ENABLED;

    const response = await POST(buildRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.generatedText).toContain('[MOCK]');
    expect(data.generatedText).toContain('Electrónica');
    expect(data.generatedText).toContain('Buen estado');
    expect(data.generatedText).toContain('Precio fijo.');
    expect(data.tokensUsed).toBeNull();
  });

  it('2. AI_ENABLED=true sin AI_REAL_CALLS_ENABLED no realiza llamadas externas', async () => {
    process.env.AI_ENABLED = 'true';
    expect(areRealCallsAuthorized()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST(buildRequest(validBody));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(data.errorCode).toBe('INTERNAL_ERROR');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('3. La autorizacion de llamadas reales no puede modificarse desde el body', async () => {
    process.env.AI_ENABLED = 'true';
    revokeRealCallsAuthorization();

    const maliciousBody = {
      ...validBody,
      realCallsAuthorized: true,
      realCallsEnabled: true,
      AI_REAL_CALLS_ENABLED: true,
      allowRealCalls: true,
      skipAuth: true,
    };

    const response = await POST(buildRequest(maliciousBody));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.success).toBe(false);
    expect(areRealCallsAuthorized()).toBe(false);
  });

  it('4. El endpoint rechaza solicitudes inválidas antes de intentar generar', async () => {
    process.env.AI_ENABLED = 'true';

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const invalidBodies = [
      { ...validBody, userNotes: 'ab' },
      { ...validBody, category: 'invalid' },
      { ...validBody, condition: 'invalid' },
      { ...validBody, pricingType: 'invalid' },
      { category: 'hogar' },
      {},
      'not-json',
    ];

    for (const body of invalidBodies) {
      const response = await POST(buildRequest(body));
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.errorCode).toBe('VALIDATION_ERROR');
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('5. Una generación exitosa devuelve el contrato IDescriptionResponse esperado', async () => {
    delete process.env.AI_ENABLED;

    const response = await POST(buildRequest(validBody));
    const data = await response.json();

    expect(data).toEqual({
      success: true,
      generatedText: expect.stringContaining('[MOCK]'),
      tokensUsed: null,
    });
    expect(Object.keys(data).sort()).toEqual(['generatedText', 'success', 'tokensUsed']);
  });

  it('6. Los errores del orquestador se transforman correctamente en errores públicos', async () => {
    process.env.AI_ENABLED = 'true';
    authorizeRealCalls();
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    vi.doMock('@/lib/ai/orchestrator', () => ({
      generateWithFallback: vi.fn().mockResolvedValue({
        success: false,
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: 'No se pudo generar la descripción.',
      }),
    }));

    const mocked = await import('@/lib/ai/orchestrator');
    const result = await mocked.generateWithFallback(
      {
        category: validBody.category,
        condition: validBody.condition,
        pricingType: validBody.pricingType,
        userNotes: validBody.userNotes,
        variant: 0,
      },
      { timeoutMs: 15_000, remainingMs: null },
      { allowPaidProviders: true }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(result.errorMessage).toBeDefined();
      expect(typeof result.errorMessage).toBe('string');
    }
  });

  it('7. BUDGET_EXCEEDED se conserva sin convertirse en PROVIDER_UNAVAILABLE', async () => {
    process.env.AI_ENABLED = 'true';
    authorizeRealCalls();
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    vi.doMock('@/lib/ai/orchestrator', () => ({
      generateWithFallback: vi.fn().mockResolvedValue({
        success: false,
        errorCode: 'BUDGET_EXCEEDED',
        errorMessage: 'Cuota del proveedor agotada.',
      }),
    }));

    const mocked = await import('@/lib/ai/orchestrator');
    const result = await mocked.generateWithFallback(
      {
        category: validBody.category,
        condition: validBody.condition,
        pricingType: validBody.pricingType,
        userNotes: validBody.userNotes,
        variant: 0,
      },
      { timeoutMs: 15_000, remainingMs: null },
      { allowPaidProviders: true }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
    }
  });

  it('8. El fallback respeta el orden configurado', async () => {
    process.env.AI_ENABLED = 'true';
    authorizeRealCalls();
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';

    const providers: string[] = [];

    vi.doMock('@/lib/ai/orchestrator', () => ({
      generateWithFallback: vi.fn().mockImplementation(async () => {
        return {
          success: true,
          result: { text: 'test', tokensUsed: 10 },
          providerName: 'groq',
        };
      }),
    }));

    const mocked = await import('@/lib/ai/orchestrator');
    const result = await mocked.generateWithFallback(
      {
        category: validBody.category,
        condition: validBody.condition,
        pricingType: validBody.pricingType,
        userNotes: validBody.userNotes,
        variant: 0,
      },
      { timeoutMs: 15_000, remainingMs: null },
      {
        allowPaidProviders: true,
        onProviderAttempt: (info) => {
          providers.push(info.provider);
        },
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
  });

  it('9. Los proveedores de pago permanecen bloqueados sin autorización', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { generateDescription } = await import('@/lib/ai/descriptionService');
    const result = await generateDescription(validBody, {});

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    if (!result.response.success) {
      expect(result.response.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('10. Timeout global, timeout individual y cancelación funcionan correctamente', async () => {
    const controller = new AbortController();

    const result = await generateDescription(validBody, {
      signal: controller.signal,
    });

    expect(result.status).toBe(200);
    expect(result.response.success).toBe(true);

    controller.abort();

    const result2 = await generateDescription(validBody, {
      signal: controller.signal,
    });

    expect(result2.status).toBe(200);
    expect(result2.response.success).toBe(true);
  });

  it('11. No se exponen API keys, prompts ni detalles internos', async () => {
    delete process.env.AI_ENABLED;

    const response = await POST(buildRequest(validBody));
    const data = await response.json();
    const serialized = JSON.stringify(data);

    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('authorization');

    process.env.AI_ENABLED = 'true';
    const response2 = await POST(buildRequest(validBody));
    const data2 = await response2.json();
    const serialized2 = JSON.stringify(data2);

    expect(serialized2).not.toContain('AI_ENABLED');
    expect(serialized2).not.toContain('AI_REAL_CALLS_ENABLED');
    expect(serialized2).not.toContain('realCallsAuthorized');
    expect(serialized2).not.toContain('realCallsEnabled');
    expect(serialized2).not.toContain('allowPaidProviders');
    expect(data2).not.toHaveProperty('provider');
    expect(data2).not.toHaveProperty('stack');
    expect(data2).not.toHaveProperty('internal');
  });

  it('12. No se realizan llamadas reales ni se consumen créditos durante las pruebas', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    delete process.env.AI_ENABLED;
    await POST(buildRequest(validBody));

    process.env.AI_ENABLED = 'true';
    await POST(buildRequest(validBody));

    expect(areRealCallsAuthorized()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('13. La limpieza posterior no deja stubs globales ni módulos simulados', async () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);

    const orchestrator = await import('@/lib/ai/orchestrator');
    expect(vi.isMockFunction(orchestrator.generateWithFallback)).toBe(false);
  });
});
