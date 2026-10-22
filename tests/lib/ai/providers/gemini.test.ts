import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '@/lib/ai/providers/gemini';
import { AIProviderError } from '@/lib/ai/errors';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
} from '@/lib/ai/types';

const baseRequest: AIProviderGenerationRequest = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%',
  variant: 0,
};

const baseContext: AIProviderCallContext = {
  timeoutMs: 15_000,
  remainingMs: null,
};

function mockFetchResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

describe('GeminiProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('implementa IAIProvider con nombre gemini y isPaid=true', () => {
    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    expect(provider.name).toBe('gemini');
    expect(provider.isPaid).toBe(true);
  });

  it('genera descripción exitosamente y normaliza la respuesta', async () => {
    const mockData: unknown = {
      candidates: [
        {
          content: {
            parts: [{ text: 'iPhone 13 en buen estado, batería al 85%.' }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      },
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');
    const result = await provider.generate(baseRequest, baseContext);

    expect(result.text).toBe('iPhone 13 en buen estado, batería al 85%.');
    expect(result.tokensUsed).toBe(150);
  });

  it('construye la solicitud con el prompt builder y la API key', async () => {
    const mockData: unknown = {
      candidates: [{ content: { parts: [{ text: 'Texto generado' }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GeminiProvider('my-secret-key', 'gemini-2.5-flash');
    await provider.generate(baseRequest, baseContext);

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];

    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-2.5-flash');
    expect(url).toContain('my-secret-key');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    expect(body.systemInstruction.parts[0]!.text).toContain(
      'descripción en español'
    );
    expect(body.contents[0]!.parts[0]!.text).toContain(
      '<<<DATOS_DEL_PRODUCTO>>>'
    );
  });

  it('maneja respuesta vacía', async () => {
    const mockData: unknown = { candidates: [] };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toThrow(
      AIProviderError
    );
    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      provider: 'gemini',
    });
  });

  it('maneja JSON inválido en la respuesta', async () => {
    const invalidResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(invalidResponse);

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Invalid JSON response',
    });
  });

  it('clasifica error 400 como INVALID_REQUEST', async () => {
    const mockData = { error: { code: 400, message: 'Bad request' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 400));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'INVALID_REQUEST',
      provider: 'gemini',
    });
  });

  it('clasifica error 401 como AUTH_ERROR', async () => {
    const mockData = { error: { code: 401, message: 'Unauthorized' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 401));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'AUTH_ERROR',
      provider: 'gemini',
    });
  });

  it('clasifica error 403 como AUTH_ERROR', async () => {
    const mockData = { error: { code: 403, message: 'Forbidden' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 403));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'AUTH_ERROR',
      provider: 'gemini',
    });
  });

  it('clasifica error 429 como RATE_LIMITED', async () => {
    const mockData = { error: { code: 429, message: 'Rate limit exceeded' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 429));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      provider: 'gemini',
    });
  });

  it('clasifica error 500 como PROVIDER_ERROR', async () => {
    const mockData = { error: { code: 500, message: 'Internal server error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 500));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      provider: 'gemini',
    });
  });

  it('respeta AbortSignal del cliente', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');
    const context: AIProviderCallContext = {
      ...baseContext,
      abortSignal: controller.signal,
    };

    await expect(provider.generate(baseRequest, context)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Request aborted by client',
      requestDispatched: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aplica timeout con AbortController', async () => {
    vi.mocked(fetch).mockImplementation(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
        })
    );

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');
    const context: AIProviderCallContext = {
      ...baseContext,
      timeoutMs: 50,
    };

    await expect(provider.generate(baseRequest, context)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Request timed out or was aborted',
    });
  });

  it('retorna tokensUsed=null cuando no hay usageMetadata', async () => {
    const mockData: unknown = {
      candidates: [{ content: { parts: [{ text: 'Descripción' }] } }],
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');
    const result = await provider.generate(baseRequest, baseContext);

    expect(result.tokensUsed).toBeNull();
  });

  it('no registra API keys, prompts ni datos de productos en errores', async () => {
    const mockData = { error: { code: 500, message: 'Server error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 500));

    const provider = new GeminiProvider('super-secret-key', 'gemini-2.5-flash');

    try {
      await provider.generate(baseRequest, baseContext);
      expect.unreachable();
    } catch (error) {
      const err = error as AIProviderError;
      expect(err.message).not.toContain('super-secret-key');
      expect(err.message).not.toContain('iPhone 13');
      expect(err.message).not.toContain('descripción en español');
    }
  });
});
