import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../src/app/api/generate/route';
import {
  authorizeRealCalls,
  revokeRealCallsAuthorization,
} from '../../src/lib/ai/descriptionService';
import { resetAIConfigCache } from '../../src/lib/ai/config';
import { setSupabaseClient, resetSupabaseClient } from '../../src/lib/db/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

const validBody = {
  category: 'electronica' as const,
  condition: 'buen_estado' as const,
  pricingType: 'fijo' as const,
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

function buildRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

type MockMode = {
  quotaResult?: unknown;
  rateResult?: unknown;
  budgetResult?: unknown;
  confirmQuotaError?: boolean;
  confirmBudgetError?: boolean;
  rateError?: boolean;
  quotaError?: boolean;
  budgetError?: boolean;
  recordError?: boolean;
};

function createMockClient(mode: MockMode = {}): SupabaseClient {
  const rpc = vi.fn(async (name: string) => {
    if (mode.rateError || mode.quotaError || mode.budgetError) {
      if (
        name === 'check_rate_limit' ||
        name === 'reserve_quota' ||
        name === 'reserve_budget' ||
        name === 'confirm_budget' ||
        name === 'confirm_quota'
      ) {
        return { data: null, error: { message: 'connection failed' } };
      }
    }

    if (name === 'check_rate_limit') {
      return {
        data:
          mode.rateResult ?? {
            status: 'allowed',
            counts: { minute: 1, hour: 1, day: 1 },
            limits: { minute: 10, hour: 100, day: 500 },
          },
        error: null,
      };
    }

    if (name === 'reserve_quota') {
      return {
        data:
          mode.quotaResult ?? {
            status: 'reserved',
            generations_used: 1,
            max_generations: 5,
          },
        error: null,
      };
    }

    if (name === 'release_quota') {
      return { data: { status: 'released' }, error: null };
    }

    if (name === 'confirm_quota') {
      if (mode.confirmQuotaError) {
        return { data: null, error: { message: 'connection failed' } };
      }
      return { data: { status: 'confirmed' }, error: null };
    }

    if (name === 'reserve_budget') {
      return {
        data:
          mode.budgetResult ?? {
            status: 'reserved',
            reservation_id: 'budget-1',
            month: '2026-10',
            reserved_cost_usd: 0.001843,
            spent_usd: 0,
            reserved_usd: 0.001843,
            total_budget_usd: 5,
          },
        error: null,
      };
    }

    if (name === 'confirm_budget') {
      if (mode.confirmBudgetError) {
        return { data: null, error: { message: 'connection failed' } };
      }
      return { data: { status: 'confirmed' }, error: null };
    }

    if (name === 'release_budget') {
      return { data: { status: 'released' }, error: null };
    }

    return { data: { status: 'ok' }, error: null };
  }) as unknown as (...args: unknown[]) => Promise<unknown>;

  const from = vi.fn(() => ({
    insert: vi.fn(async () => {
      if (mode.recordError) {
        return { data: null, error: { message: 'insert failed' } };
      }
      return { data: null, error: null };
    }),
  })) as unknown as (...args: unknown[]) => unknown;

  return { rpc, from } as unknown as SupabaseClient;
}

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_GEMINI_API_KEY',
  'TRUST_PROXY',
  'AI_GEMINI_MODEL',
  'AI_GEMINI_TIMEOUT_MS',
  'AI_GLOBAL_TIMEOUT_MS',
] as const;

function setupRealEnv() {
  process.env.AI_ENABLED = 'true';
  process.env.AI_GEMINI_API_KEY = 'test-key';
  process.env.TRUST_PROXY = 'true';
}

describe('POST /api/generate T-004-6 protections', () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Descripción generada' }] } }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    fetchMock.mockClear();

    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }

    revokeRealCallsAuthorization();
    resetAIConfigCache();
    resetSupabaseClient();
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
    revokeRealCallsAuthorization();
    resetAIConfigCache();
    resetSupabaseClient();
    vi.unstubAllGlobals();
  });

  it('A: request inválido no consume protección', async () => {
    setupRealEnv();
    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest({ ...validBody, userNotes: 'ab' }));

    expect(response.status).toBe(400);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('B: AI_ENABLED=false mantiene MOCK', async () => {
    delete process.env.AI_ENABLED;
    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.generatedText).toContain('[MOCK]');
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('C: realCallsAuthorized=false responde 503 sin consumo', async () => {
    setupRealEnv();
    const client = createMockClient();
    setSupabaseClient(client);
    revokeRealCallsAuthorization();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(503);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('D: IP desconocida fail-closed', async () => {
    setupRealEnv();
    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(429);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalledWith('reserve_quota', expect.anything());
  });

  it('E: rate limit excedido no reserva cuota ni presupuesto', async () => {
    setupRealEnv();
    const client = createMockClient({
      rateResult: {
        status: 'rate_limited',
        window: 'minute',
        limit: 10,
        current: 10,
        retry_after_seconds: 10,
      },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(429);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalledWith('reserve_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('reserve_budget', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('F: cuota agotada no reserva presupuesto', async () => {
    setupRealEnv();
    const client = createMockClient({
      quotaResult: {
        status: 'quota_exceeded',
        generations_used: 5,
        max_generations: 5,
      },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(429);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalledWith('reserve_budget', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('G: presupuesto agotado libera cuota y no llama proveedor', async () => {
    setupRealEnv();
    const client = createMockClient({
      budgetResult: {
        status: 'budget_exceeded',
        month: '2026-10',
        spent_usd: 4.76,
        reserved_usd: 0,
        total_budget_usd: 5,
        available_usd: 0,
      },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(402);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).toHaveBeenCalledWith('release_quota', expect.anything());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('H: éxito confirma cuota y presupuesto', async () => {
    setupRealEnv();
    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).toHaveBeenCalledWith('confirm_budget', expect.anything());
    expect(rpc).toHaveBeenCalledWith('reserve_quota', expect.anything());
    expect(rpc).toHaveBeenCalledWith('reserve_budget', expect.anything());
  });

  it('I: todos los proveedores fallan liberan cuota', async () => {
    setupRealEnv();
    process.env.AI_GEMINI_API_KEY = 'test-key';
    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'server error' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    );

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(503);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).toHaveBeenCalledWith('release_quota', expect.anything());
  });

  it('J: timeout posterior al envío no libera presupuesto', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.TRUST_PROXY = 'true';
    process.env.AI_GEMINI_TIMEOUT_MS = '1';
    process.env.AI_GLOBAL_TIMEOUT_MS = '1';

    const client = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            );
          }, 50);
        })
    );

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect([503, 500, 408, 200]).toContain(response.status);

    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).not.toHaveBeenCalledWith('release_budget', expect.anything());
  });

  it('N: falla de generation_records no duplica ni revierte consumos', async () => {
    setupRealEnv();
    const client = createMockClient({ recordError: true });
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(200);
    const rpc = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).toHaveBeenCalledWith('confirm_budget', expect.anything());
  });

  it('O: falla PostgreSQL fail-closed', async () => {
    setupRealEnv();
    const client = createMockClient({ quotaError: true });
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(
      buildRequest(validBody, { 'x-real-ip': '192.0.2.10' })
    );

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.errorCode).toBe('INTERNAL_ERROR');
  });
});

