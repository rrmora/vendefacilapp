import { getAIConfig } from './config';
import { generateWithFallback } from './orchestrator';
import type { IDescriptionRequest, IDescriptionResponse } from '@/types/description';

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

export interface GenerateDescriptionResult {
  response: IDescriptionResponse;
  status: number;
}

let realCallsAuthorized = false;

export function authorizeRealCalls(): void {
  realCallsAuthorized = true;
}

export function revokeRealCallsAuthorization(): void {
  realCallsAuthorized = false;
}

export function areRealCallsAuthorized(): boolean {
  return realCallsAuthorized;
}

export async function generateDescription(
  input: IDescriptionRequest,
  options: { signal?: AbortSignal } = {}
): Promise<GenerateDescriptionResult> {
  const config = getAIConfig();

  if (!config.enabled) {
    return { response: mockResponse(input), status: 200 };
  }

  if (!realCallsAuthorized) {
    return {
      response: errorResponse(
        'INTERNAL_ERROR',
        'La generación con IA no está disponible todavía.'
      ),
      status: 503,
    };
  }

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
    { allowPaidProviders: true }
  );

  if (outcome.success) {
    return {
      response: {
        success: true,
        generatedText: outcome.result.text,
        tokensUsed: outcome.result.tokensUsed,
      },
      status: 200,
    };
  }

  const status = outcome.errorCode === 'VALIDATION_ERROR' ? 400
    : outcome.errorCode === 'RATE_LIMITED' ? 429
    : outcome.errorCode === 'BUDGET_EXCEEDED' ? 402
    : outcome.errorCode === 'PROVIDER_UNAVAILABLE' ? 503
    : 500;

  return {
    response: errorResponse(
      outcome.errorCode as 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'BUDGET_EXCEEDED' | 'INTERNAL_ERROR',
      outcome.errorMessage
    ),
    status,
  };
}
