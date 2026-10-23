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
import type {
  BudgetController,
  BudgetControllerResult,
} from '@/lib/ai/orchestrator';
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
  const reserve = vi.fn(async (): Promise<BudgetControllerResult> => ({
    allowed: true,
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
      expect(result.quotaDisposition).toBe('release');
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
      expect(result.quotaDisposition).toBe('complete');
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
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
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

  it('libera la reserva cuando el proveedor de pago falla antes de enviar', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    mockOpenAIGenerate.mockRejectedValue(createPreSendError('openai'));

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(result.quotaDisposition).toBe('release');
      expect(result.consumptionUnknown).toBe(false);
    }
    expect(budget.release).toHaveBeenCalledWith('budget-1');
    expect(budget.consumeUnknown).not.toHaveBeenCalled();
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('libera la reserva del proveedor de pago y conserva el fallback gratuito exitoso', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '2';

    mockOpenAIGenerate.mockRejectedValue(createPreSendError('openai'));
    mockGroqGenerate.mockResolvedValue({ text: 'Descripción de Groq', tokensUsed: 100 });

    const budget = createBudgetController();
    budget.reserve.mockResolvedValueOnce({
      allowed: true,
      reservation: { reservationId: 'budget-1', maxCostUsd: 0.001843 },
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(budget.release).toHaveBeenCalledWith('budget-1');
    expect(budget.confirmReservation).not.toHaveBeenCalled();
    expect(budget.consumeUnknown).not.toHaveBeenCalled();
  });

  it('conserva el consumo incierto cuando el fallo ocurre después del envío', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    mockOpenAIGenerate.mockRejectedValue(createRecoverableError('openai'));

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.quotaDisposition).toBe('complete');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gpt-4o-mini');
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('conserva el consumo incierto del proveedor de pago si el fallback gratuito falla antes de enviar', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '2';

    mockOpenAIGenerate.mockRejectedValue(createRecoverableError('openai'));
    mockGroqGenerate.mockRejectedValue(createPreSendError('groq'));

    const budget = createBudgetController();
    budget.reserve.mockResolvedValueOnce({
      allowed: true,
      reservation: { reservationId: 'budget-1', maxCostUsd: 0.001843 },
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('PROVIDER_UNAVAILABLE');
      expect(result.quotaDisposition).toBe('complete');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(mockOpenAIGenerate).toHaveBeenCalledTimes(1);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGroqGenerate.mock.invocationCallOrder[0]!
    );
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(budget.consumeUnknown).toHaveBeenCalledTimes(1);
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gpt-4o-mini');
    expect(budget.release).not.toHaveBeenCalled();
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
      expect(result.quotaDisposition).toBe('complete');
      expect(result.consumptionUnknown).toBe(true);
    }
  });

  it('conserva el consumo incierto en errores no recuperables posteriores al envío', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    mockOpenAIGenerate.mockRejectedValue(
      new AIProviderError({
        kind: 'SECURITY_BLOCK',
        provider: 'openai',
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
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gpt-4o-mini');
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('falla cerrado y no hace fallback si no puede liberar la reserva pre-envío', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '2';

    mockOpenAIGenerate.mockRejectedValue(createPreSendError('openai'));

    const budget = createBudgetController();
    budget.release.mockRejectedValue(new Error('database unavailable'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
      expect(result.quotaDisposition).toBe('leave_uncertain');
      expect(result.compensationFailed).toBe(true);
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.release).toHaveBeenCalledWith('budget-1');
    expect(mockGroqGenerate).not.toHaveBeenCalled();
  });

  it('marca release cuando el presupuesto se rechaza antes de llamar al proveedor', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    const budget = createBudgetController();
    budget.reserve.mockResolvedValue({
      allowed: false,
      reason: 'budget_exceeded',
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
      expect(result.quotaDisposition).toBe('release');
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('clasifica como complete una excepción desconocida del proveedor', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    mockOpenAIGenerate.mockRejectedValue(new Error('socket hang up'));

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.quotaDisposition).toBe('complete');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gpt-4o-mini');
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('no clasifica como dispatch una excepción al reservar presupuesto', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    const budget = createBudgetController();
    budget.reserve.mockRejectedValue(new Error('budget database unavailable'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.quotaDisposition).toBe('release');
      expect(result.consumptionUnknown).toBe(false);
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('mantiene complete si falla la confirmación de presupuesto tras el envío', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    mockOpenAIGenerate.mockResolvedValue({ text: 'Descripción', tokensUsed: 100 });

    const budget = createBudgetController();
    budget.confirmReservation.mockRejectedValue(
      new Error('budget database unavailable')
    );

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
      expect(result.quotaDisposition).toBe('complete');
      expect(result.consumptionUnknown).toBe(true);
    }
    expect(budget.consumeUnknown).toHaveBeenCalledWith('budget-1', 'gpt-4o-mini');
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('mantiene complete si falla la compensación del fallback de pago tras un envío', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '1';
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '2';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockOpenAIGenerate.mockRejectedValue(createPreSendError('openai'));

    const budget = createBudgetController();
    budget.reserve.mockResolvedValueOnce({
      allowed: true,
      reservation: { reservationId: 'budget-1', maxCostUsd: 0.001843 },
    });
    budget.release.mockRejectedValue(new Error('budget database unavailable'));

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.quotaDisposition).toBe('complete');
      expect(result.compensationFailed).toBe(true);
    }
    expect(budget.release).toHaveBeenCalledWith('budget-1');
  });
});

describe('T-005.1 política de proveedores gratuitos y de pago', () => {
  it('vuelve a evaluar Gemini en una nueva solicitud después de una falla recuperable', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValueOnce(createRecoverableError('gemini'));
    mockGroqGenerate.mockResolvedValueOnce({
      text: 'Descripción de Groq',
      tokensUsed: 100,
    });

    const first = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.providerName).toBe('groq');
    }

    mockGeminiGenerate.mockResolvedValueOnce({
      text: 'Descripción de Gemini',
      tokensUsed: 100,
    });

    const second = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.providerName).toBe('gemini');
    }
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(2);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);
  });

  it('no reserva presupuesto para un proveedor gratuito', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    mockGeminiGenerate.mockResolvedValue({
      text: 'Descripción de Gemini',
      tokensUsed: 100,
    });

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('gemini');
    }
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('hace fallback entre proveedores gratuitos sin reservar presupuesto', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockGroqGenerate.mockResolvedValue({
      text: 'Descripción de Groq',
      tokensUsed: 100,
    });

    const budget = createBudgetController();

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('continúa con un proveedor gratuito cuando el presupuesto de pago está agotado', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';

    mockGeminiGenerate.mockResolvedValue({
      text: 'Descripción de Gemini',
      tokensUsed: 100,
    });

    const budget = createBudgetController();
    budget.reserve.mockResolvedValue({
      allowed: false,
      reason: 'budget_exceeded',
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('gemini');
    }
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.reserve).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(budget.confirmReservation).not.toHaveBeenCalled();
    expect(budget.release).not.toHaveBeenCalled();
  });

  it('devuelve BUDGET_EXCEEDED si todos los gratuitos fallan de forma recuperable', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';
    process.env.AI_GROQ_PRIORITY = '3';

    mockGeminiGenerate.mockRejectedValue(createRecoverableError('gemini'));
    mockGroqGenerate.mockRejectedValue(createRecoverableError('groq'));

    const budget = createBudgetController();
    budget.reserve.mockResolvedValue({
      allowed: false,
      reason: 'budget_exceeded',
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
    }
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(budget.confirmReservation).not.toHaveBeenCalled();
  });

  it('no hace fallback ante BUDGET_EXCEEDED devuelto por OpenAI', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';

    mockOpenAIGenerate.mockRejectedValue(
      new AIProviderError({
        kind: 'BUDGET_EXCEEDED',
        provider: 'openai',
        message: 'Provider quota exceeded',
      })
    );

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
    }
    expect(mockOpenAIGenerate).toHaveBeenCalledTimes(1);
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('mantiene budget_unavailable como error interno sin probar proveedores', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GEMINI_PRIORITY = '2';

    const budget = createBudgetController();
    budget.reserve.mockResolvedValue({
      allowed: false,
      reason: 'budget_unavailable',
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('bloquea OpenAI cuando el presupuesto está agotado', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    mockOpenAIGenerate.mockResolvedValue({
      text: 'Descripción de OpenAI',
      tokensUsed: 100,
    });

    const budget = createBudgetController();
    budget.reserve.mockResolvedValue({
      allowed: false,
      reason: 'budget_exceeded',
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      budgetController: budget.controller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('BUDGET_EXCEEDED');
      expect(result.quotaDisposition).toBe('release');
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
    expect(budget.reserve).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
  });

  it('no habilita OpenAI con API key si falta AI_OPENAI_ENABLED aunque allowPaidProviders sea true', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';

    mockOpenAIGenerate.mockResolvedValue({
      text: 'Descripción de OpenAI',
      tokensUsed: 100,
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
  });

  it('permite OpenAI con AI_OPENAI_ENABLED=true y allowPaidProviders=true', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    mockOpenAIGenerate.mockResolvedValue({
      text: 'Descripción de OpenAI',
      tokensUsed: 100,
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('openai');
    }
  });

  it('usa un proveedor gratuito aunque allowPaidProviders sea false', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';

    mockGeminiGenerate.mockResolvedValue({
      text: 'Descripción de Gemini',
      tokensUsed: 100,
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('gemini');
    }
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
  });

  it('excluye OpenAI cuando allowPaidProviders es false aunque esté habilitado', async () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    mockOpenAIGenerate.mockResolvedValue({
      text: 'Descripción de OpenAI',
      tokensUsed: 100,
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorCode).toBe('INTERNAL_ERROR');
    }
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
  });
});

describe('T-005.4 recuperación de proveedores entre solicitudes', () => {
  it('hace fallback a Groq cuando Gemini falla de forma recuperable', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    const attempts: string[] = [];

    mockGeminiGenerate.mockRejectedValueOnce(createRecoverableError('gemini'));
    mockGroqGenerate.mockResolvedValueOnce({
      text: 'Descripción de Groq',
      tokensUsed: 100,
    });

    const result = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      onProviderAttempt: ({ provider }) => attempts.push(provider),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerName).toBe('groq');
    }
    expect(attempts).toEqual(['gemini', 'groq']);
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);
    expect(mockGeminiGenerate.mock.invocationCallOrder[0]).toBeLessThan(
      mockGroqGenerate.mock.invocationCallOrder[0]!
    );
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
  });

  it('reintenta Gemini en la siguiente solicitud y no invoca Groq al recuperarse', async () => {
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_ENABLED = 'true';

    const firstAttempts: string[] = [];
    const secondAttempts: string[] = [];

    mockGeminiGenerate
      .mockRejectedValueOnce(createRecoverableError('gemini'))
      .mockResolvedValueOnce({
        text: 'Descripción de Gemini',
        tokensUsed: 100,
      });
    mockGroqGenerate.mockResolvedValueOnce({
      text: 'Descripción de Groq',
      tokensUsed: 100,
    });

    const first = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      onProviderAttempt: ({ provider }) => firstAttempts.push(provider),
    });

    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.providerName).toBe('groq');
    }
    expect(firstAttempts).toEqual(['gemini', 'groq']);
    expect(mockGeminiGenerate).toHaveBeenCalledTimes(1);
    expect(mockGroqGenerate).toHaveBeenCalledTimes(1);

    const geminiCallsAfterFirst = mockGeminiGenerate.mock.calls.length;
    const groqCallsAfterFirst = mockGroqGenerate.mock.calls.length;

    const second = await generateWithFallback(baseRequest, baseContext, {
      allowPaidProviders: true,
      onProviderAttempt: ({ provider }) => secondAttempts.push(provider),
    });

    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.providerName).toBe('gemini');
    }
    expect(secondAttempts).toEqual(['gemini']);
    expect(mockGeminiGenerate.mock.calls.length).toBe(geminiCallsAfterFirst + 1);
    expect(mockGroqGenerate.mock.calls.length).toBe(groqCallsAfterFirst);
    expect(mockOpenAIGenerate).not.toHaveBeenCalled();
  });
});
