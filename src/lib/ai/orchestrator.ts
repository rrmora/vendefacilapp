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

export interface OrchestratorOptions {
  allowPaidProviders?: boolean;
  onProviderAttempt?: (info: {
    provider: string;
    success: boolean;
    durationMs: number;
    errorKind?: string;
  }) => void;
}

interface ProviderEntry {
  name: string;
  priority: number;
  isPaid: boolean;
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
        create: () => new GeminiProvider(p.apiKey!, p.model),
      });
    } else if (p.name === 'groq') {
      providers.push({
        name: p.name,
        priority: p.priority,
        isPaid: p.isPaid,
        create: () => new GroqProvider(p.apiKey!, p.model),
      });
    } else if (p.name === 'openai') {
      providers.push({
        name: p.name,
        priority: p.priority,
        isPaid: p.isPaid,
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

    try {
      const result = await provider.generate(request, {
        ...context,
        timeoutMs: Math.min(context.timeoutMs, remaining),
        remainingMs: remaining,
      });

      options.onProviderAttempt?.({
        provider: providerInfo.name,
        success: true,
        durationMs: Date.now() - providerStart,
      });

      return {
        success: true,
        result,
        providerName: providerInfo.name,
      };
    } catch (error) {
      const durationMs = Date.now() - providerStart;

      if (error instanceof AIProviderError) {
        options.onProviderAttempt?.({
          provider: providerInfo.name,
          success: false,
          durationMs,
          errorKind: error.kind,
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
          success: false,
          durationMs,
          errorKind: 'UNKNOWN',
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
