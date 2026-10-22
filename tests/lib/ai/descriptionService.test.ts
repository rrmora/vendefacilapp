import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mockGenerateWithFallback } = vi.hoisted(() => ({
  mockGenerateWithFallback: vi.fn(),
}));

vi.mock('@/lib/ai/orchestrator', () => ({
  generateWithFallback: mockGenerateWithFallback,
}));

import {
  authorizeRealCalls,
  generateDescription,
  revokeRealCallsAuthorization,
} from '@/lib/ai/descriptionService';
import { resetAIConfigCache } from '@/lib/ai/config';
import type { OrchestratorOptions } from '@/lib/ai/orchestrator';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
} from '@/lib/ai/types';
import { resetSupabaseClient, setSupabaseClient } from '@/lib/db/supabaseClient';
import type { IDescriptionRequest } from '@/types/description';

const validInput: IDescriptionRequest = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

const visitorId = '123e4567-e89b-42d3-a456-426614174000';

const ENV_KEYS = ['AI_ENABLED', 'AI_GEMINI_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

type MockClientOptions = {
  releaseQuotaResult?: unknown;
  releaseQuotaError?: boolean;
  confirmQuotaResult?: unknown;
  confirmQuotaError?: boolean;
};

function createMockClient(options: MockClientOptions = {}): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'check_rate_limit') {
      return {
        data: {
          status: 'allowed',
          counts: { minute: 1, hour: 1, day: 1 },
          limits: { minute: 10, hour: 100, day: 500 },
        },
        error: null,
      };
    }

    if (name === 'reserve_quota') {
      return {
        data: { status: 'reserved', generations_used: 1, max_generations: 5 },
        error: null,
      };
    }

    if (name === 'mark_quota_sent') {
      return { data: { status: 'sent' }, error: null };
    }

    if (name === 'reserve_budget') {
      return {
        data: {
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

    if (name === 'confirm_quota') {
      if (options.confirmQuotaError) {
        return { data: null, error: { message: 'confirm failed' } };
      }

      return {
        data: options.confirmQuotaResult ?? { status: 'confirmed' },
        error: null,
      };
    }

    if (name === 'confirm_budget') {
      return { data: { status: 'confirmed' }, error: null };
    }

    if (name === 'release_quota') {
      if (options.releaseQuotaError) {
        return { data: null, error: { message: 'release failed' } };
      }

      return {
        data: options.releaseQuotaResult ?? { status: 'released' },
        error: null,
      };
    }

    if (name === 'release_budget') {
      return { data: { status: 'released' }, error: null };
    }

    return { data: { status: 'ok' }, error: null };
  });

  const from = vi.fn(() => ({
    insert: vi.fn(async () => ({ data: null, error: null })),
  }));

  return {
    client: { rpc, from } as unknown as SupabaseClient,
    rpc,
  };
}

describe('generateDescription compensación exterior', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
    process.env.AI_ENABLED = 'true';
    process.env.AI_GEMINI_API_KEY = 'test-key';

    resetAIConfigCache();
    resetSupabaseClient();
    revokeRealCallsAuthorization();
    mockGenerateWithFallback.mockReset();
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
  });

  it('no libera cuota si el orquestador lanza después de registrar un intento', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        await options?.onProviderAttempt?.({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          success: true,
          durationMs: 1,
          result: { text: 'texto', tokensUsed: 10 },
        });
        throw new Error('unexpected orchestration failure');
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(500);
    expect(result.response.success).toBe(false);
    if (result.response.success) {
      throw new Error('Expected failure response');
    }
    expect(result.response.errorCode).toBe('INTERNAL_ERROR');
    expect(rpc).not.toHaveBeenCalledWith('release_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_budget', expect.anything());
  });

  it('trata un resultado inesperado de releaseQuota como fallo de compensación', async () => {
    const { client, rpc } = createMockClient({
      releaseQuotaResult: { status: 'unexpected' },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'provider unavailable',
      consumptionUnknown: false,
      quotaDisposition: 'release',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('release_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_budget', expect.anything());
  });

  it('trata una excepción de releaseQuota como fallo de compensación', async () => {
    const { client, rpc } = createMockClient({ releaseQuotaError: true });
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'provider unavailable',
      consumptionUnknown: false,
      quotaDisposition: 'release',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('release_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_budget', expect.anything());
  });

  it('confirma la cuota cuando la disposición es complete aunque la generación falle', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'budget confirmation failed',
      consumptionUnknown: true,
      quotaDisposition: 'complete',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_quota', expect.anything());
  });

  it('no libera ni confirma la cuota cuando la disposición es leave_uncertain', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'compensation failed',
      consumptionUnknown: false,
      compensationFailed: true,
      quotaDisposition: 'leave_uncertain',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).not.toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_quota', expect.anything());
  });

  it('no devuelve 200 si confirmQuota devuelve un estado incompatible', async () => {
    const { client, rpc } = createMockClient({
      confirmQuotaResult: { status: 'not_found' },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: true,
      result: { text: 'texto generado', tokensUsed: 10 },
      providerName: 'gemini',
      quotaDisposition: 'complete',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_quota', expect.anything());
  });

  it('no devuelve 200 si confirmQuota lanza una excepción', async () => {
    const { client, rpc } = createMockClient({ confirmQuotaError: true });
    setSupabaseClient(client);
    authorizeRealCalls();

    mockGenerateWithFallback.mockResolvedValueOnce({
      success: true,
      result: { text: 'texto generado', tokensUsed: 10 },
      providerName: 'gemini',
      quotaDisposition: 'complete',
    });

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(503);
    expect(result.response.success).toBe(false);
    expect(rpc).toHaveBeenCalledWith('confirm_quota', expect.anything());
    expect(rpc).not.toHaveBeenCalledWith('release_quota', expect.anything());
  });
});
