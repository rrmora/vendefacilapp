import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { mockGenerateWithFallback } = vi.hoisted(() => ({
  mockGenerateWithFallback: vi.fn(),
}));

vi.mock('@/lib/ai/orchestrator', () => ({
  generateWithFallback: mockGenerateWithFallback,
}));

import { generateDescription } from '@/lib/ai/descriptionService';
import {
  authorizeRealCalls,
  restoreRealCallsEnv,
  revokeRealCallsAuthorization,
} from '../../helpers/aiRealCalls';
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

const tokenUsage = {
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: 10,
};

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_REAL_CALLS_ENABLED',
  'AI_GEMINI_API_KEY',
] as const;
const originalEnv: Record<string, string | undefined> = {};

type MockClientOptions = {
  releaseQuotaResult?: unknown;
  releaseQuotaError?: boolean;
  confirmQuotaResult?: unknown;
  confirmQuotaError?: boolean;
  confirmBudgetResult?: unknown;
};

function createMockClient(options: MockClientOptions = {}): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
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
      return {
        data: options.confirmBudgetResult ?? {
          status: 'confirmed',
          month: '2026-10',
          reserved_cost_usd: 0.001843,
          actual_cost_usd: 0.00018,
          cost_estimated: true,
        },
        error: null,
      };
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

  const insert = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({ insert }));

  return {
    client: { rpc, from } as unknown as SupabaseClient,
    rpc,
    insert,
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
    restoreRealCallsEnv(originalEnv.AI_REAL_CALLS_ENABLED);
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
          result: { text: 'texto', usage: tokenUsage },
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
      result: { text: 'texto generado', usage: tokenUsage },
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
      result: { text: 'texto generado', usage: tokenUsage },
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

  it('rechaza un modelo de pago sin precio antes de reservar presupuesto', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    let budgetResult: unknown;

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        budgetResult = await options?.budgetController?.reserve(
          'openai',
          'unknown-paid-model'
        );
        return {
          success: false,
          errorCode: 'INTERNAL_ERROR',
          errorMessage: 'pricing unavailable',
          quotaDisposition: 'release',
        };
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(budgetResult).toEqual({
      allowed: false,
      reason: 'pricing_unavailable',
    });
    expect(rpc).not.toHaveBeenCalledWith('reserve_budget', expect.anything());
    expect(result.status).toBe(503);
  });

  it('confirma el presupuesto con tarifas separadas de input y output', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const usage = {
      inputTokens: 600,
      outputTokens: 200,
      reasoningTokens: 0,
      totalTokens: 800,
    };

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        await options?.budgetController?.confirmReservation(
          'budget-1',
          usage,
          'gpt-4o-mini'
        );
        return {
          success: true,
          result: { text: 'texto generado', usage },
          providerName: 'openai',
          quotaDisposition: 'complete',
        };
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('confirm_budget', {
      p_reservation_id: 'budget-1',
      p_actual_cost_usd: 0.00021,
      p_cost_estimated: false,
    });
  });

  it('emite una señal explícita cuando el costo confirmado supera la reserva', async () => {
    const { client } = createMockClient({
      confirmBudgetResult: {
        status: 'confirmed',
        month: '2026-10',
        reserved_cost_usd: 0.0001,
        actual_cost_usd: 0.00021,
        cost_estimated: false,
      },
    });
    setSupabaseClient(client);
    authorizeRealCalls();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const usage = {
        inputTokens: 600,
        outputTokens: 200,
        reasoningTokens: 0,
        totalTokens: 800,
      };

      mockGenerateWithFallback.mockImplementationOnce(
        async (
          _request: AIProviderGenerationRequest,
          _context: AIProviderCallContext,
          options?: OrchestratorOptions
        ) => {
          await options?.budgetController?.confirmReservation(
            'budget-1',
            usage,
            'gpt-4o-mini'
          );
          return {
            success: true,
            result: { text: 'texto generado', usage },
            providerName: 'openai',
            quotaDisposition: 'complete',
          };
        }
      );

      await generateDescription(validInput, {
        visitorId,
        clientIp: '192.0.2.10',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[ai-budget] reservation exceeded',
        expect.objectContaining({
          reservationId: 'budget-1',
          model: 'gpt-4o-mini',
          reservedCostUsd: 0.0001,
          actualCostUsd: 0.00021,
          excessCostUsd: 0.00011,
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('registra el uso real y señala cuando supera el límite de salida', async () => {
    const { client, insert } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const usage = {
        inputTokens: 100,
        outputTokens: 2048,
        reasoningTokens: 0,
        totalTokens: 2148,
      };

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
            result: { text: 'texto generado', usage },
          });
          return {
            success: true,
            result: { text: 'texto generado', usage },
            providerName: 'gemini',
            quotaDisposition: 'complete',
          };
        }
      );

      await generateDescription(validInput, {
        visitorId,
        clientIp: '192.0.2.10',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[ai-provider] reported billable output above configured limit',
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          maxOutputTokens: 1024,
          billableOutputTokens: 2048,
          visibleOutputTokens: 2048,
          reasoningTokens: 0,
        })
      );
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens_input: 100,
          tokens_output: 2048,
          cost_estimated: false,
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('marca el costo como estimado cuando el proveedor no reporta uso', async () => {
    const { client, insert } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const usage = {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    };

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
          result: { text: 'texto generado', usage },
        });
        return {
          success: true,
          result: { text: 'texto generado', usage },
          providerName: 'gemini',
          quotaDisposition: 'complete',
        };
      }
    );

    await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens_input: null,
        tokens_output: null,
        cost_estimated: true,
        estimated_cost_usd: 0.00018,
      })
    );
  });

  it('incluye tokens de razonamiento en el costo sin duplicar el total público', async () => {
    const { client, rpc, insert } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 100,
      totalTokens: 250,
    };

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        await options?.budgetController?.confirmReservation(
          'budget-1',
          usage,
          'gemini-2.5-flash'
        );
        await options?.onProviderAttempt?.({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          success: true,
          durationMs: 1,
          result: { text: 'texto generado', usage },
        });
        return {
          success: true,
          result: { text: 'texto generado', usage },
          providerName: 'gemini',
          quotaDisposition: 'complete',
        };
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(200);
    expect(result.response.tokensUsed).toBe(250);
    expect(rpc).toHaveBeenCalledWith('confirm_budget', {
      p_reservation_id: 'budget-1',
      p_actual_cost_usd: 0.000105,
      p_cost_estimated: false,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens_input: 100,
        tokens_output: 150,
        estimated_cost_usd: 0.000105,
        cost_estimated: false,
      })
    );
  });

  it('marca el costo como estimado si falta el razonamiento reportado', async () => {
    const { client, rpc, insert } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: null,
      totalTokens: 150,
    };

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        await options?.budgetController?.confirmReservation(
          'budget-1',
          usage,
          'gemini-2.5-flash'
        );
        await options?.onProviderAttempt?.({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          success: true,
          durationMs: 1,
          result: { text: 'texto generado', usage },
        });
        return {
          success: true,
          result: { text: 'texto generado', usage },
          providerName: 'gemini',
          quotaDisposition: 'complete',
        };
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(200);
    expect(result.response.tokensUsed).toBe(150);
    expect(rpc).toHaveBeenCalledWith('confirm_budget', {
      p_reservation_id: 'budget-1',
      p_actual_cost_usd: 0.000135,
      p_cost_estimated: true,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens_input: 100,
        tokens_output: null,
        cost_estimated: true,
      })
    );
  });

  it('descarta el total público y estima el costo si los contadores son inconsistentes', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 100,
      totalTokens: 100,
    };

    mockGenerateWithFallback.mockImplementationOnce(
      async (
        _request: AIProviderGenerationRequest,
        _context: AIProviderCallContext,
        options?: OrchestratorOptions
      ) => {
        await options?.budgetController?.confirmReservation(
          'budget-1',
          usage,
          'gemini-2.5-flash'
        );
        return {
          success: true,
          result: { text: 'texto generado', usage },
          providerName: 'gemini',
          quotaDisposition: 'complete',
        };
      }
    );

    const result = await generateDescription(validInput, {
      visitorId,
      clientIp: '192.0.2.10',
    });

    expect(result.status).toBe(200);
    expect(result.response.tokensUsed).toBeNull();
    expect(rpc).toHaveBeenCalledWith('confirm_budget', {
      p_reservation_id: 'budget-1',
      p_actual_cost_usd: 0.000135,
      p_cost_estimated: true,
    });
  });

  it('no afirma exceso de salida cuando el razonamiento no es observable', async () => {
    const { client } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: null,
        totalTokens: 2048,
      };

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
            result: { text: 'texto generado', usage },
          });
          return {
            success: true,
            result: { text: 'texto generado', usage },
            providerName: 'gemini',
            quotaDisposition: 'complete',
          };
        }
      );

      await generateDescription(validInput, {
        visitorId,
        clientIp: '192.0.2.10',
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
