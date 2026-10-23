import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqProvider } from '@/lib/ai/providers/groq';
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

describe('GroqProvider', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('implementa IAIProvider con nombre groq y isPaid=false', () => {
    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    expect(provider.name).toBe('groq');
    expect(provider.isPaid).toBe(false);
  });

  it('genera descripción exitosamente y normaliza la respuesta', async () => {
    const mockData: unknown = {
      choices: [
        {
          message: {
            content: 'iPhone 13 en buen estado, batería al 85%.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');
    const result = await provider.generate(baseRequest, baseContext);

    expect(result.text).toBe('iPhone 13 en buen estado, batería al 85%.');
    expect(result.tokensUsed).toBe(150);
  });

  it('retorna tokensUsed=null cuando no hay usage', async () => {
    const mockData: unknown = {
      choices: [
        {
          message: { content: 'Descripción del producto' },
          finish_reason: 'stop',
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');
    const result = await provider.generate(baseRequest, baseContext);

    expect(result.text).toBe('Descripción del producto');
    expect(result.tokensUsed).toBeNull();
  });

  it('construye la solicitud con mensajes system y user', async () => {
    const mockData: unknown = {
      choices: [{ message: { content: 'Texto generado' } }],
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GroqProvider('my-secret-key', 'llama-3.3-70b-versatile');
    await provider.generate(baseRequest, baseContext);

    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(options.method).toBe('POST');

    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(options.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toContain('descripción en español');
    expect(body.messages[1]!.role).toBe('user');
    expect(body.messages[1]!.content).toContain('<<<DATOS_DEL_PRODUCTO>>>');
  });

  it('maneja respuesta vacía', async () => {
    const mockData: unknown = { choices: [] };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      provider: 'groq',
      message: 'Empty response from provider',
    });
  });

  it('maneja contenido null en message', async () => {
    const mockData: unknown = {
      choices: [{ message: { content: null } }],
    };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Empty response from provider',
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

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Invalid JSON response',
    });
  });

  it('clasifica error 400 como INVALID_REQUEST', async () => {
    const mockData = { error: { message: 'Bad request', type: 'invalid_request_error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 400));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'INVALID_REQUEST',
      provider: 'groq',
    });
  });

  it('clasifica error 401 como AUTH_ERROR', async () => {
    const mockData = { error: { message: 'Unauthorized', type: 'authentication_error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 401));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'AUTH_ERROR',
      provider: 'groq',
    });
  });

  it('clasifica error 403 como AUTH_ERROR', async () => {
    const mockData = { error: { message: 'Forbidden', type: 'permission_error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 403));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'AUTH_ERROR',
      provider: 'groq',
    });
  });

  it('clasifica error 429 como RATE_LIMITED', async () => {
    const mockData = { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 429));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'RATE_LIMITED',
      provider: 'groq',
    });
  });

  it('clasifica error 500 como PROVIDER_ERROR', async () => {
    const mockData = { error: { message: 'Internal server error', type: 'server_error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 500));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      provider: 'groq',
    });
  });

  it('respeta AbortSignal del cliente', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');
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

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');
    const context: AIProviderCallContext = {
      ...baseContext,
      timeoutMs: 50,
    };

    await expect(provider.generate(baseRequest, context)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      message: 'Request timed out or was aborted',
    });
  });

  it('maneja errores de red', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const provider = new GroqProvider('test-key', 'llama-3.3-70b-versatile');

    await expect(provider.generate(baseRequest, baseContext)).rejects.toMatchObject({
      kind: 'PROVIDER_ERROR',
      provider: 'groq',
    });
  });

  it('no registra API keys, prompts ni datos de productos en errores', async () => {
    const mockData = { error: { message: 'Server error' } };
    vi.mocked(fetch).mockResolvedValue(mockFetchResponse(mockData, 500));

    const provider = new GroqProvider('super-secret-key', 'llama-3.3-70b-versatile');

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
