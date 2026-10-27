import { getAIConfig } from './config';
import { generateWithFallback } from './orchestrator';
import {
  getBillableOutputTokens,
  getPublicTotalTokens,
  hasCompleteTokenUsage,
} from './tokenUsage';
import type { AIProviderTokenUsage } from './types';
import type { IDescriptionRequest, IDescriptionResponse } from '@/types/description';
import {
  reserveQuota,
  confirmQuota,
  releaseQuota,
  markQuotaSent,
  QuotaServiceError,
} from '@/lib/quota/quotaService';
import {
  checkRateLimit,
  RateLimiterError,
  normalizeIpAddress,
} from '@/lib/ratelimit/rateLimiter';
import {
  reserveBudget,
  confirmBudget,
  releaseBudget,
  calculateMaxCostUsd,
  calculateActualCostUsd,
  getBudgetMonth,
  getModelPricing,
  BudgetServiceError,
} from '@/lib/budget/budgetService';
import type { ModelPricing } from '@/lib/budget/budgetService';
import { recordGeneration } from '@/lib/generations/generationRecordService';
import { isValidVisitorId } from '@/lib/visitors/visitorService';
import type { BudgetController } from './orchestrator';

const CATEGORY_LABELS: Record<IDescriptionRequest['category'], string> = {
  ropa: 'Ropa y accesorios',
  electronica: 'Electrónica',
  hogar: 'Hogar',
  vehiculos: 'Vehículos',
  otros: 'Otros',
};

const CONDITION_LABELS: Record<IDescriptionRequest['condition'], string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  detalles_uso: 'Con detalles de uso',
};

function buildMockDescription(input: IDescriptionRequest): string {
  const pricing =
    input.pricingType === 'negociable'
      ? 'Acepto ofertas.'
      : 'Precio fijo.';

  return [
    `[MOCK] ${CATEGORY_LABELS[input.category]} — ${CONDITION_LABELS[input.condition]}.`,
    '',
    input.userNotes.trim(),
    '',
    pricing,
  ].join('\n');
}

function mockResponse(input: IDescriptionRequest): IDescriptionResponse {
  return {
    success: true,
    generatedText: buildMockDescription(input),
    tokensUsed: null,
  };
}

function errorResponse(
  errorCode: 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'BUDGET_EXCEEDED' | 'INTERNAL_ERROR',
  errorMessage: string
): IDescriptionResponse {
  return {
    success: false,
    generatedText: '',
    tokensUsed: null,
    errorCode,
    errorMessage,
  };
}

function quotaReleaseSucceeded(
  result: Awaited<ReturnType<typeof releaseQuota>>
): boolean {
  if (result.status === 'released') {
    return true;
  }

  return (
    result.status === 'already_processed' &&
    (result.previousStatus === 'released' || result.previousStatus === 'expired')
  );
}

function quotaConfirmationSucceeded(
  result: Awaited<ReturnType<typeof confirmQuota>>
): boolean {
  return (
    result.status === 'confirmed' ||
    (result.status === 'already_processed' &&
      result.previousStatus === 'completed')
  );
}

function quotaMarkSentSucceeded(
  result: Awaited<ReturnType<typeof markQuotaSent>>
): boolean {
  return result.status === 'sent' || result.status === 'already_sent';
}

function budgetConfirmationSucceeded(
  result: Awaited<ReturnType<typeof confirmBudget>>
): boolean {
  return (
    result.status === 'confirmed' ||
    (result.status === 'already_processed' &&
      result.previousStatus === 'confirmed')
  );
}

function calculateUsageCost(
  pricing: ModelPricing,
  usage: AIProviderTokenUsage
): { actualCostUsd: number; costEstimated: boolean } {
  const costEstimated = !hasCompleteTokenUsage(usage);
  const actualCostUsd = calculateActualCostUsd({
    pricing,
    tokensInput: usage.inputTokens,
    tokensOutput: getBillableOutputTokens(usage),
    costEstimated,
  });

  return { actualCostUsd, costEstimated };
}

function warnBudgetDiscrepancy(details: {
  reservationId: string;
  model: string;
  reservedCostUsd: number;
  actualCostUsd: number;
  excessCostUsd: number;
}): void {
  console.warn('[ai-budget] reservation exceeded', details);
}

function warnOutputLimitExceeded(details: {
  provider: string;
  model: string;
  maxOutputTokens: number;
  billableOutputTokens: number;
  visibleOutputTokens: number | null;
  reasoningTokens: number | null;
}): void {
  console.warn(
    '[ai-provider] reported billable output above configured limit',
    details
  );
}

export interface GenerateDescriptionResult {
  response: IDescriptionResponse;
  status: number;
}

export interface GenerateDescriptionOptions {
  signal?: AbortSignal;
  visitorId?: string | null;
  clientIp?: string | null;
}

export async function generateDescription(
  input: IDescriptionRequest,
  options: GenerateDescriptionOptions = {}
): Promise<GenerateDescriptionResult> {
  const config = getAIConfig();

  if (!config.enabled) {
    return { response: mockResponse(input), status: 200 };
  }

  if (!config.realCallsEnabled) {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'La generación con IA no está disponible todavía.'
      ),
      status: 503,
    };
  }

  const hasEligibleProvider = config.providers.some(
    (provider) => provider.enabled && provider.apiKey !== null
  );

  if (!hasEligibleProvider) {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'La generación con IA no está disponible todavía.'
      ),
      status: 503,
    };
  }

  const visitorId = options.visitorId ?? null;
  const clientIp = options.clientIp ?? null;

  if (!visitorId || !isValidVisitorId(visitorId)) {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'La generación con IA no está disponible todavía.'
      ),
      status: 503,
    };
  }

  const normalizedIp = normalizeIpAddress(clientIp);
  if (!normalizedIp) {
    return {
      response: errorResponse(
        'RATE_LIMITED',
        'Has alcanzado el límite temporal de generaciones. Inténtalo más tarde.'
      ),
      status: 429,
    };
  }

  try {
    const rateLimit = await checkRateLimit(normalizedIp);
    if (rateLimit.status === 'invalid_ip') {
      return {
        response: errorResponse(
          'RATE_LIMITED',
          'Has alcanzado el límite temporal de generaciones. Inténtalo más tarde.'
        ),
        status: 429,
      };
    }

    if (rateLimit.status === 'rate_limited') {
      return {
        response: errorResponse(
          'RATE_LIMITED',
          'Has alcanzado el límite temporal de generaciones. Inténtalo más tarde.'
        ),
        status: 429,
      };
    }
  } catch {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'No se pudo verificar el límite de solicitudes.'
      ),
      status: 503,
    };
  }

  let quotaReservationId: string | null = null;
  try {
    const quota = await reserveQuota(visitorId);
    quotaReservationId = quota.status === 'reserved' ? quota.reservationId : null;

    if (quota.status === 'quota_exceeded') {
      return {
        response: errorResponse(
          'RATE_LIMITED',
          'Has alcanzado el límite de generaciones disponibles por hoy.'
        ),
        status: 429,
      };
    }

    if (quota.status === 'rate_limited') {
      return {
        response: errorResponse(
          'RATE_LIMITED',
          'Has alcanzado el límite temporal de generaciones. Inténtalo más tarde.'
        ),
        status: 429,
      };
    }
  } catch {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'No se pudo verificar la cuota disponible.'
      ),
      status: 503,
    };
  }

  const month = getBudgetMonth();
  const budgetController: BudgetController = {
    reserve: async (provider, model) => {
      const pricing = getModelPricing(model);
      if (!pricing) {
        return { allowed: false, reason: 'pricing_unavailable' };
      }

      const maxCostUsd = calculateMaxCostUsd(pricing);
      try {
        const result = await reserveBudget({
          month,
          maxCostUsd,
        });

        if (result.status === 'reserved' || result.status === 'already_reserved') {
          return {
            allowed: true,
            reservation: {
              reservationId: result.reservationId,
              maxCostUsd: result.reservedCostUsd,
            },
          };
        }

        if (result.status === 'budget_exceeded') {
          return { allowed: false, reason: 'budget_exceeded' };
        }

        return { allowed: false, reason: 'budget_unavailable' };
      } catch {
        return { allowed: false, reason: 'budget_unavailable' };
      }
    },
    confirmReservation: async (reservationId, usage, model) => {
      const pricing = getModelPricing(model);
      if (!pricing) {
        throw new BudgetServiceError(
          'No hay precio explícito para el modelo utilizado.'
        );
      }

      const { actualCostUsd, costEstimated } = calculateUsageCost(
        pricing,
        usage
      );

      const result = await confirmBudget({
        reservationId,
        actualCostUsd,
        costEstimated,
      });

      if (!budgetConfirmationSucceeded(result)) {
        throw new BudgetServiceError(
          'No se pudo confirmar la reserva de presupuesto.'
        );
      }

      if (result.status === 'confirmed' && result.exceedsReservation) {
        warnBudgetDiscrepancy({
          reservationId,
          model,
          reservedCostUsd: result.reservedCostUsd,
          actualCostUsd: result.actualCostUsd,
          excessCostUsd: result.excessCostUsd,
        });
      }
    },
    consumeUnknown: async (reservationId, model) => {
      const pricing = getModelPricing(model);
      if (!pricing) {
        throw new BudgetServiceError(
          'No hay precio explícito para el modelo utilizado.'
        );
      }

      const costEstimated = true;
      const actualCostUsd = calculateActualCostUsd({
        pricing,
        tokensInput: null,
        tokensOutput: null,
        costEstimated,
      });

      const result = await confirmBudget({
        reservationId,
        actualCostUsd,
        costEstimated,
      });

      if (!budgetConfirmationSucceeded(result)) {
        throw new BudgetServiceError(
          'No se pudo confirmar la reserva de presupuesto.'
        );
      }

      if (result.status === 'confirmed' && result.exceedsReservation) {
        warnBudgetDiscrepancy({
          reservationId,
          model,
          reservedCostUsd: result.reservedCostUsd,
          actualCostUsd: result.actualCostUsd,
          excessCostUsd: result.excessCostUsd,
        });
      }
    },
    release: async (reservationId) => {
      const result = await releaseBudget(reservationId);

      if (result.status === 'released') {
        return;
      }

      if (
        result.status === 'already_processed' &&
        result.previousStatus === 'released'
      ) {
        return;
      }

      throw new BudgetServiceError('No se pudo confirmar la liberación de presupuesto.');
    },
  };

  if (quotaReservationId) {
    try {
      const markResult = await markQuotaSent(quotaReservationId);

      if (!quotaMarkSentSucceeded(markResult)) {
        return {
          response: errorResponse(
            'INTERNAL_ERROR',
            'La generación con IA no está disponible todavía.'
          ),
          status: 503,
        };
      }
    } catch {
      return {
        response: errorResponse(
          'INTERNAL_ERROR',
          'La generación con IA no está disponible todavía.'
        ),
        status: 503,
      };
    }
  }

  try {
    const outcome = await generateWithFallback(
      {
        category: input.category,
        condition: input.condition,
        pricingType: input.pricingType,
        userNotes: input.userNotes,
        variant: 0,
      },
      {
        timeoutMs: 15_000,
        remainingMs: null,
        abortSignal: options.signal,
      },
      {
        allowPaidProviders: true,
        budgetController,
        onProviderAttempt: async (info) => {
          const providerConfig = config.providers.find(
            (provider) => provider.name === info.provider
          );
          const model = info.model ?? providerConfig?.model ?? null;
          const pricing = model ? getModelPricing(model) : null;
          const usage = info.result?.usage ?? null;
          const tokensInput = usage?.inputTokens ?? null;
          const visibleOutputTokens = usage?.outputTokens ?? null;
          const reasoningTokens = usage?.reasoningTokens ?? null;
          const billableOutputTokens = usage
            ? getBillableOutputTokens(usage)
            : null;
          const costEstimated =
            usage === null || !hasCompleteTokenUsage(usage);
          const maxCost = pricing ? calculateMaxCostUsd(pricing) : 0;

          const estimatedCostUsd = pricing
            ? info.success
              ? calculateActualCostUsd({
                  pricing,
                  tokensInput,
                  tokensOutput: billableOutputTokens,
                  costEstimated,
                })
              : costEstimated
                ? calculateActualCostUsd({
                    pricing,
                    tokensInput: null,
                    tokensOutput: null,
                    costEstimated: true,
                  })
                : maxCost
            : 0;

          if (
            info.success &&
            pricing &&
            billableOutputTokens !== null &&
            billableOutputTokens > pricing.maxOutputTokens
          ) {
            warnOutputLimitExceeded({
              provider: info.provider,
              model: info.model,
              maxOutputTokens: pricing.maxOutputTokens,
              billableOutputTokens,
              visibleOutputTokens,
              reasoningTokens,
            });
          }

          try {
            await recordGeneration({
              visitorId,
              quotaReservationId,
              success: info.success,
              provider: info.provider,
              model,
              tokensInput,
              tokensOutput: billableOutputTokens,
              estimatedCostUsd,
              costEstimated,
              errorCode: info.success
                ? null
                : info.errorKind ?? 'PROVIDER_ERROR',
            });
          } catch {
            // La falla del registro no borra ni libera presupuesto ya consumido.
          }
        },
      }
    );

    if (quotaReservationId) {
      try {
        if (outcome.quotaDisposition === 'release') {
          const releaseResult = await releaseQuota(quotaReservationId);
          if (!quotaReleaseSucceeded(releaseResult)) {
            return {
              response: errorResponse(
                'INTERNAL_ERROR',
                'La generación con IA no está disponible todavía.'
              ),
              status: 503,
            };
          }
        } else if (outcome.quotaDisposition === 'complete') {
          const confirmResult = await confirmQuota(quotaReservationId);
          if (!quotaConfirmationSucceeded(confirmResult)) {
            return {
              response: errorResponse(
                'INTERNAL_ERROR',
                'La generación con IA no está disponible todavía.'
              ),
              status: 503,
            };
          }
        }
      } catch {
        return {
          response: errorResponse(
            'INTERNAL_ERROR',
            'La generación con IA no está disponible todavía.'
          ),
          status: 503,
        };
      }
    }

    if (outcome.success) {
      return {
        response: {
          success: true,
          generatedText: outcome.result.text,
          tokensUsed: getPublicTotalTokens(outcome.result.usage),
        },
        status: 200,
      };
    }

    let status = 500;
    if (outcome.compensationFailed) status = 503;
    else if (outcome.errorCode === 'RATE_LIMITED') status = 429;
    else if (outcome.errorCode === 'BUDGET_EXCEEDED') status = 402;
    else if (outcome.errorCode === 'PROVIDER_UNAVAILABLE') status = 503;
    else if (outcome.errorCode === 'INTERNAL_ERROR') status = 503;
    else status = 500;

    return {
      response: errorResponse(
        outcome.errorCode as
          | 'VALIDATION_ERROR'
          | 'RATE_LIMITED'
          | 'PROVIDER_UNAVAILABLE'
          | 'BUDGET_EXCEEDED'
          | 'INTERNAL_ERROR',
        outcome.errorCode === 'BUDGET_EXCEEDED'
          ? 'Has alcanzado el límite de presupuesto de IA.'
          : 'No se pudo generar la descripción. Inténtalo de nuevo.'
      ),
      status,
    };
  } catch (error) {
    // Once the orchestration starts, an unexpected throw does not prove that
    // no provider was dispatched. Keep the quota in its conservative state.
    const isQuotaError = error instanceof QuotaServiceError;
    const isRateError = error instanceof RateLimiterError;
    const isBudgetError = error instanceof BudgetServiceError;

    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'La generación con IA no está disponible todavía.'
      ),
      status: isQuotaError || isRateError || isBudgetError ? 503 : 500,
    };
  }
}
