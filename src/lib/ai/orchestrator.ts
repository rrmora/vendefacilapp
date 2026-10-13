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

export interface OrchestratorResult {
  success: true;
  result: AIProviderGenerationResult;
  providerName: string;
}

export interface OrchestratorError {
  success: false;
  errorCode: string;
  errorMessage: string;
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
    };
  }

  const globalStart = Date.now();
  const globalTimeoutMs = getAIConfig().globalTimeoutMs;
  let lastError: AIProviderError | null = null;

  for (const providerInfo of providers) {
    if (context.abortSignal?.aborted) {
      return {
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'Solicitud cancelada.',
      };
    }

    const elapsed = Date.now() - globalStart;
    const remaining = globalTimeoutMs - elapsed;
    if (remaining <= 0) {
      return {
        success: false,
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: 'Tiempo de espera agotado.',
      };
    }

    const providerStart = Date.now();
    const provider = providerInfo.create();
    let reservationId: string | null = null;

    try {
      if (budgetController && providerInfo.isPaid) {
        const budget = await budgetController.reserve(providerInfo.name, providerInfo.model);
        if (!budget.allowed) {
          if (budget.reason === 'budget_exceeded') {
            return {
              success: false,
              errorCode: 'BUDGET_EXCEEDED',
              errorMessage: 'Presupuesto de IA insuficiente.',
            };
          }
          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo verificar el presupuesto.',
          };
        }

        reservationId = budget.reservation.reservationId;
      }

      const result = await provider.generate(request, {
        ...context,
        timeoutMs: Math.min(context.timeoutMs, remaining),
        remainingMs: remaining,
      });

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
          } catch {
            // Keep the reservation committed for reconciliation if DB is still unavailable.
          }

          return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'No se pudo conciliar el presupuesto.',
          };
        }
      }

      return {
        success: true,
        result,
        providerName: providerInfo.name,
      };
    } catch (error) {
      const durationMs = Date.now() - providerStart;

      if (reservationId && budgetController) {
        try {
          await budgetController.consumeUnknown(reservationId, providerInfo.model);
        } catch {
          // Keep the original error if budget reconciliation fails.
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

        if (!isRecoverableKind(error.kind)) {
          if (error.kind === 'BUDGET_EXCEEDED') {
            return {
              success: false,
              errorCode: 'BUDGET_EXCEEDED',
              errorMessage: 'Cuota del proveedor agotada.',
            };
          }
          return {
            success: false,
            errorCode: toPublicErrorCode(error.kind),
            errorMessage: 'No se pudo generar la descripción.',
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
      errorMessage: 'No se pudo generar la descripción. Inténtalo de nuevo.',
    };
  }

  return {
    success: false,
    errorCode: 'INTERNAL_ERROR',
    errorMessage: 'No se pudo generar la descripción.',
  };
}

export function resetOrchestratorCache(): void {
  resetAIConfigCache();
}
