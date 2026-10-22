import { getAIConfig, resetAIConfigCache } from './config';
import { AIProviderError, isRecoverableKind, toPublicErrorCode } from './errors';
import { GeminiProvider } from './providers/gemini';
import { GroqProvider } from './providers/groq';
import { OpenAIProvider } from './providers/openai';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
  AIProviderGenerationResult,
  IAIProvider,
} from './types';

export type QuotaDisposition =
  | 'release'
  | 'complete'
  | 'leave_uncertain';

export interface OrchestratorResult {
  success: true;
  result: AIProviderGenerationResult;
  providerName: string;
  quotaDisposition: 'complete';
}

export interface OrchestratorError {
  success: false;
  errorCode: string;
  errorMessage: string;
  quotaDisposition: QuotaDisposition;
  consumptionUnknown?: boolean;
  compensationFailed?: boolean;
}

export type OrchestratorOutcome = OrchestratorResult | OrchestratorError;

export interface BudgetProviderReservation {
  reservationId: string;
  maxCostUsd: number;
}

export type BudgetControllerResult =
  | { allowed: true; reservation: BudgetProviderReservation }
  | { allowed: false; reason: 'budget_exceeded' }
  | { allowed: false; reason: 'budget_unavailable' };

export interface BudgetController {
  reserve(provider: string, model: string): Promise<BudgetControllerResult>;
  confirmReservation(reservationId: string, tokensUsed: number | null, model: string): Promise<void>;
  consumeUnknown(reservationId: string, model: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}

function resolveQuotaDisposition(
  anyRequestDispatched: boolean,
  compensationFailed: boolean
): QuotaDisposition {
  if (anyRequestDispatched) return 'complete';
  return compensationFailed ? 'leave_uncertain' : 'release';
}

export interface OrchestratorOptions {
  allowPaidProviders?: boolean;
  budgetController?: BudgetController;
    onProviderAttempt?: (info: {
    provider: string;
    model: string;
    success: boolean;
    durationMs: number;
    errorKind?: string;
    result?: AIProviderGenerationResult;
    budgetReservationId?: string;
  }) => void;
}

interface ProviderEntry {
  name: string;
  priority: number;
  isPaid: boolean;
  model: string;
  create: () => IAIProvider;
}

function getEligibleProviders(allowPaid: boolean): ProviderEntry[] {
  const config = getAIConfig();
  const providers: ProviderEntry[] = [];

  for (const p of config.providers) {
    if (!p.enabled || p.apiKey === null) continue;
    if (p.isPaid && !allowPaid) continue;

    if (p.name === 'gemini') {
      providers.push({
        name: p.name,
        priority: p.priority,
        isPaid: p.isPaid,
        model: p.model,
        create: () => new GeminiProvider(p.apiKey!, p.model),
      });
    } else if (p.name === 'groq') {
      providers.push({
        name: p.name,
        priority: p.priority,
        isPaid: p.isPaid,
        model: p.model,
        create: () => new GroqProvider(p.apiKey!, p.model),
      });
    } else if (p.name === 'openai') {
      providers.push({
        name: p.name,
        priority: p.priority,
        isPaid: p.isPaid,
        model: p.model,
        create: () => new OpenAIProvider(p.apiKey!, p.model),
      });
    }
  }

  return providers.sort((a, b) => a.priority - b.priority);
}

export async function generateWithFallback(
  request: AIProviderGenerationRequest,
  context: AIProviderCallContext,
  options: OrchestratorOptions = {}
): Promise<OrchestratorOutcome> {
  const allowPaid = options.allowPaidProviders ?? false;
  const budgetController = options.budgetController;
  const providers = getEligibleProviders(allowPaid);

  if (providers.length === 0) {
    return {
      success: false,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'No hay proveedores de IA configurados.',
      quotaDisposition: 'release',
    };
  }

  const globalStart = Date.now();
  const globalTimeoutMs = getAIConfig().globalTimeoutMs;
  let lastError: AIProviderError | null = null;
  let consumptionUnknown = false;
  let compensationFailed = false;
  let anyRequestDispatched = false;

  for (const providerInfo of providers) {
    if (context.abortSignal?.aborted) {
      return {
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'Solicitud cancelada.',
        quotaDisposition: resolveQuotaDisposition(
          anyRequestDispatched,
          compensationFailed
        ),
        consumptionUnknown,
      };
    }

    const elapsed = Date.now() - globalStart;
    const remaining = globalTimeoutMs - elapsed;
    if (remaining <= 0) {
      return {
        success: false,
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: 'Tiempo de espera agotado.',
        quotaDisposition: resolveQuotaDisposition(
          anyRequestDispatched,
          compensationFailed
        ),
        consumptionUnknown,
      };
    }

    const providerStart = Date.now();
    const provider = providerInfo.create();
    let reservationId: string | null = null;
    let providerCallStarted = false;

    try {
      if (budgetController && providerInfo.isPaid) {
        const budget = await budgetController.reserve(providerInfo.name, providerInfo.model);
        if (!budget.allowed) {
          if (budget.reason === 'budget_exceeded') {
            return {
              success: false,
              errorCode: 'BUDGET_EXCEEDED',
              errorMessage: 'Presupuesto de IA insuficiente.',
              quotaDisposition: resolveQuotaDisposition(
                anyRequestDispatched,
                compensationFailed
              ),
              consumptionUnknown,
            };
          }
          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo verificar el presupuesto.',
            quotaDisposition: resolveQuotaDisposition(
              anyRequestDispatched,
              compensationFailed
            ),
            consumptionUnknown,
          };
        }

        reservationId = budget.reservation.reservationId;
      }

      providerCallStarted = true;
      const result = await provider.generate(request, {
        ...context,
        timeoutMs: Math.min(context.timeoutMs, remaining),
        remainingMs: remaining,
      });
      anyRequestDispatched = true;

      options.onProviderAttempt?.({
        provider: providerInfo.name,
        model: providerInfo.model,
        success: true,
        durationMs: Date.now() - providerStart,
        result,
        budgetReservationId: reservationId ?? undefined,
      });

      if (reservationId && budgetController) {
        try {
          await budgetController.confirmReservation(
            reservationId,
            result.tokensUsed,
            providerInfo.model
          );
        } catch {
          try {
            await budgetController.consumeUnknown(reservationId, providerInfo.model);
            consumptionUnknown = true;
          } catch {
            // Keep the reservation committed for reconciliation if DB is still unavailable.
            consumptionUnknown = true;
          }

          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo conciliar el presupuesto.',
            quotaDisposition: resolveQuotaDisposition(
              anyRequestDispatched,
              compensationFailed
            ),
            consumptionUnknown,
          };
        }
      }

      return {
        success: true,
        result,
        providerName: providerInfo.name,
        quotaDisposition: 'complete',
      };
    } catch (error) {
      const durationMs = Date.now() - providerStart;
      const requestDispatched =
        providerCallStarted &&
        (error instanceof AIProviderError ? error.requestDispatched : true);

      if (requestDispatched) {
        anyRequestDispatched = true;
        consumptionUnknown = true;
        if (reservationId && budgetController) {
          try {
            await budgetController.consumeUnknown(reservationId, providerInfo.model);
          } catch {
            // The reservation remains committed for reconciliation.
          }
        }
      } else if (reservationId && budgetController) {
        try {
          await budgetController.release(reservationId);
        } catch {
          // Fail closed: without evidence of release, keep quota and budget.
          compensationFailed = true;
          consumptionUnknown = true;
        }
      }

      if (error instanceof AIProviderError) {
        options.onProviderAttempt?.({
          provider: providerInfo.name,
          model: providerInfo.model,
          success: false,
          durationMs,
          errorKind: error.kind,
          budgetReservationId: reservationId ?? undefined,
        });

        if (compensationFailed) {
          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo liberar la reserva de presupuesto.',
            quotaDisposition: resolveQuotaDisposition(
              anyRequestDispatched,
              compensationFailed
            ),
            consumptionUnknown,
            compensationFailed,
          };
        }

        if (!isRecoverableKind(error.kind)) {
          if (error.kind === 'BUDGET_EXCEEDED') {
            return {
              success: false,
              errorCode: 'BUDGET_EXCEEDED',
              errorMessage: 'Cuota del proveedor agotada.',
              quotaDisposition: resolveQuotaDisposition(
                anyRequestDispatched,
                compensationFailed
              ),
              consumptionUnknown,
            };
          }
          return {
            success: false,
            errorCode: toPublicErrorCode(error.kind),
            quotaDisposition: resolveQuotaDisposition(
              anyRequestDispatched,
              compensationFailed
            ),
            errorMessage: 'No se pudo generar la descripción.',
            consumptionUnknown,
          };
        }

        lastError = error;
      } else {
        options.onProviderAttempt?.({
          provider: providerInfo.name,
          model: providerInfo.model,
          success: false,
          durationMs,
          errorKind: 'UNKNOWN',
          budgetReservationId: reservationId ?? undefined,
        });

        if (compensationFailed) {
          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo liberar la reserva de presupuesto.',
            quotaDisposition: resolveQuotaDisposition(
              anyRequestDispatched,
              compensationFailed
            ),
            consumptionUnknown,
            compensationFailed,
          };
        }

        lastError = new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: providerInfo.name as 'gemini',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  if (lastError) {
    return {
      success: false,
      errorCode: toPublicErrorCode(lastError.kind),
      quotaDisposition: resolveQuotaDisposition(
        anyRequestDispatched,
        compensationFailed
      ),
      errorMessage: 'No se pudo generar la descripción. Inténtalo de nuevo.',
      consumptionUnknown,
    };
  }

  return {
    success: false,
    errorCode: 'INTERNAL_ERROR',
    quotaDisposition: resolveQuotaDisposition(
      anyRequestDispatched,
      compensationFailed
    ),
    errorMessage: 'No se pudo generar la descripción.',
    consumptionUnknown,
  };
}

export function resetOrchestratorCache(): void {
  resetAIConfigCache();
}
