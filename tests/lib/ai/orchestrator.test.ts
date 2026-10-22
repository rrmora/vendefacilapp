import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGeminiGenerate = vi.fn();
const mockGroqGenerate = vi.fn();
const mockOpenAIGenerate = vi.fn();

vi.mock('@/lib/ai/providers/gemini', () => ({
  GeminiProvider: class {
    readonly name = 'gemini' as const;
    readonly isPaid = true;
    generate = mockGeminiGenerate;
  },
}));

vi.mock('@/lib/ai/providers/groq', () => ({
  GroqProvider: class {
    readonly name = 'groq' as const;
    readonly isPaid = true;
    generate = mockGroqGenerate;
  },
}));

vi.mock('@/lib/ai/providers/openai', () => ({
  OpenAIProvider: class {
    readonly name = 'openai' as const;
    readonly isPaid = true;
    generate = mockOpenAIGenerate;
  },
}));

import {
  generateWithFallback,
  resetOrchestratorCache,
} from '@/lib/ai/orchestrator';
import type { BudgetController } from '@/lib/ai/orchestrator';
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

const ENV_KEYS = [
  'AI_ENABLED',
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
  resetOrchestratorCache();
  vi.clearAllMocks();
  vi.useRealTimers();
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
  resetOrchestratorCache();
  vi.useRealTimers();
});

function createRecoverableError(provider: 'gemini' | 'groq' | 'openai'): AIProviderError {
  return new AIProviderError({
    kind: 'PROVIDER_ERROR',
    provider,
    message: 'Temporary error',
    requestDispatched: true,
  });
}

function createPreSendError(provider: 'gemini' | 'groq' | 'openai'): AIProviderError {
  return new AIProviderError({
    kind: 'PROVIDER_ERROR',
    provider,
    message: 'Aborted before dispatch',
    requestDispatched: false,
  });
}

function createBudgetController() {
  const reserve = vi.fn(async () => ({
    allowed: true as const,
    reservation: {
      reservationId: 'budget-1',
      maxCostUsd: 0.001843,
    },
  }));
  const confirmReservation = vi.fn(async () => {});
  const consumeUnknown = vi.fn(async () => {});
  const release = vi.fn(async () => {});

  const controller: BudgetController = {
    reserve,
    confirmReservation,
    consumeUnknown,
    release,
  };

  return { controller, reserve, confirmReservation, consumeUnknown, release };
}

describe('generateWithFallback', () => {
  it('devuelve INTERNAL_ERROR cuando no hay proveedores configurados', async () => {
    const result = await generateWithFallback(baseRequest, baseContext);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
  });

  it('ejecuta el primer proveedor exitosamente', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockResolvedValue({ text: 'Descripción de Gemini', tokensUsed: 100 });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('gemini');
      expect(result.result.text).toBe('Descripción de Gemini');
    }
    expect(mockGroqGenerate).not.toHaveBeenCalled();
  });

  it('hace fallback de Gemini a Groq cuando Gemini falla con error recuperable', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockGroqGenerate.mockResolvedValue({ text: 'Descripción de Groq', tokensUsed: 100 });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
      expect(result.result.text).toBe('Descripción de Groq');
    }
  });

  it('omite proveedores sin configuración', async () => {
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    mockGroqGenerate.mockResolvedValue({ text: 'Descripción de Groq', tokensUsed: 100 });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
  });

  it('bloquea proveedores de pago por defecto', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('devuelve PROVIDER_UNAVAILABLE cuando todos los proveedores fallan', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockGroqGenerate.mockRejectedValue(createRecoverableError('groq'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
    }
  });

  it('detiene la cadena ante error no recuperable (SECURITY_BLOCK)', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    const securityError = new AIProviderError({
      kind: 'SECURITY_BLOCK',
      provider: 'gemini',
      message: 'Blocked',
    });
    mockGeminiGenerate.mockRejectedValue(securityError);

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(mockGroqGenerate).not.toHaveBeenCalled();
  });

  it('detiene la cadena ante BUDGET_EXCEEDED', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    const budgetError = new AIProviderError({
      kind: 'BUDGET_EXCEEDED',
      provider: 'gemini',
      message: 'Quota exceeded',
    });
    mockGeminiGenerate.mockRejectedValue(budgetError);

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
    }
    expect(mockGroqGenerate).not.toHaveBeenCalled();
  });

  it('pasa timeout individual al proveedor', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockResolvedValue({ text: 'Descripción', tokensUsed: 100 });

    await generateWithFallback(baseRequest, {
      ...baseContext,
      timeoutMs: 5_000,
    }, { allowPaidProviders: true });

    expect(mockGeminiGenerate).toHaveBeenCalledWith(
      baseRequest,
      expect.objectContaining({ timeoutMs: 5_000 })
    );
  });

  it('pasa tiempo restante global al proveedor', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GLOBAL_TIMEOUT_MS = '25000';
    mockGeminiGenerate.mockResolvedValue({ text: 'Descripción', tokensUsed: 100 });

    await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(mockGeminiGenerate).toHaveBeenCalledWith(
      baseRequest,
      expect.objectContaining({ remainingMs: expect.any(Number) })
    );
    const call = mockGeminiGenerate.mock.calls[0] as [unknown, AIProviderCallContext];
    expect(call[1].remainingMs!).toBeLessThanOrEqual(25_000);
    expect(call[1].remainingMs!).toBeGreaterThan(0);
  });

  it('respeta cancelación del cliente', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateWithFallback(
      baseRequest,
      { ...baseContext, abortSignal: controller.signal },
      { allowPaidProviders: true }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
  });

  it('respeta el orden configurable de proveedores', async () => {
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';

    mockGroqGenerate.mockResolvedValue({ text: 'Descripción de Groq', tokensUsed: 100 });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('registra metadatos técnicos seguros en onProviderAttempt', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockResolvedValue({ text: 'Descripción', tokensUsed: 100 });

    const attempts: Array<{
      provider: string;
      success: boolean;
      durationMs: number;
      errorKind?: string;
    }> = [];

    await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      onProviderAttempt: (info) => {
        attempts.push(info);
      },
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.provider).toBe('gemini');
    expect(attempts[0]!.success).toBe(true);
    expect(typeof attempts[0]!.durationMs).toBe('number');
  });

  it('libera la reserva cuando el proveedor falla antes de enviar', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockRejectedValue(createPreSendError('gemini'));

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(result.consumptionUnknown).toBe(false);
    }
    expect(budget.release).toHaveBeenCalledWith('budget-1');
    expect(budget.consumeUnknown).not.toHaveBeenCalled();
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('libera la primera reserva y conserva el consumo del fallback exitoso', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createPreSendError('gemini'));
    mockGroqGenerate.mockResolvedValue({ text: 'Descripción de Groq', tokensUsed: 100 });

    const budget = createBudgetController();
    budget.reserve
      .mockResolvedValueOnce({
        allowed: true,
        reservation: { reservationId: 'budget-1', maxCostUsd: 0.001843 },
      })
      .mockResolvedValueOnce({
        allowed: true,
        reservation: { reservationId: 'budget-2', maxCostUsd: 0.001843 },
      });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
    expect(budget.reserve).toHaveBeenCalledTimes(2);
    expect(budget.release).toHaveBeenCalledWith('budget-1');
    expect(budget.confirmReservation).toHaveBeenCalledWith(
      'budget-2',
      100,
      'llama-3.3-70b-versatile'
    );
    expect(budget.consumeUnknown).not.toHaveBeenCalled();
  });

  it('conserva el consumo incierto cuando el fallo ocurre después del envío', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gemini-2.5-flash');
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('conserva el consumo incierto si el fallback falla antes de enviar', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockGroqGenerate.mockRejectedValue(createPreSendError('groq'));

    const budget = createBudgetController();
    budget.reserve
      .mockResolvedValueOnce({
        allowed: true,
        reservation: { reservationId: 'budget-1', maxCostUsd: 0.001843 },
      })
      .mockResolvedValueOnce({
        allowed: true,
        reservation: { reservationId: 'budget-2', maxCostUsd: 0.001843 },
      });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);
    expect(mockGeminiGenerate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGroqGenerate.mock.invocationCallOrder[0]!
    );
    expect(budget.reserve).toHaveBeenNthCalledWith(1, 'gemini', 'gemini-2.5-flash');
    expect(budget.reserve).toHaveBeenNthCalledWith(2, 'groq', 'llama-3.3-70b-versatile');
    expect(budget.consumeUnknown).toHaveBeenCalledTimes(1);
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gemini-2.5-flash');
    expect(budget.release).toHaveBeenCalledTimes(1);
    expect(budget.release).toHaveBeenCalledWith('budget-2');
    expect(budget.release).not.toHaveBeenCalledWith('budget-1');
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('marca consumo incierto aunque el proveedor no tenga reserva de presupuesto', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.consumptionUnknown).toBe(true);
    }
  });

  it('conserva el consumo incierto en errores no recuperables posteriores al envío', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    mockGeminiGenerate.mockRejectedValue(
      new AIProviderError({
        kind: 'SECURITY_BLOCK',
        provider: 'gemini',
        message: 'Blocked',
      })
    );

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.consumeUnknown).toHaveBeenCalled();
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('falla cerrado y no hace fallback si no puede liberar la reserva pre-envío', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createPreSendError('gemini'));

    const budget = createBudgetController();
    budget.release.mockRejectedValue(new Error('database unavailable'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
      expect(result.compensationFailed).toBe(true);
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(mockGroqGenerate).not.toHaveBeenCalled();
  });
});
