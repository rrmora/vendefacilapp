import type { DescriptionErrorCode } from '@/types/description';
import type { AIProviderName } from './types';

export type AIProviderErrorKind =
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_CONFIGURED'
  | 'SECURITY_BLOCK'
  | 'BUDGET_EXCEEDED'
  | 'INVALID_REQUEST';

const RECOVERABLE_KINDS: ReadonlySet<AIProviderErrorKind> = new Set([
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'AUTH_ERROR',
  'NOT_CONFIGURED',
]);

/**
 * Internal error for provider failures. `message` is for server-side logs
 * only: it must never contain API keys, tokens, prompts, or personal data.
 */
export class AIProviderError extends Error {
  readonly kind: AIProviderErrorKind;
  readonly provider: AIProviderName;
  readonly recoverable: boolean;

  constructor(options: {
    kind: AIProviderErrorKind;
    provider: AIProviderName;
    message: string;
  }) {
    super(options.message);
    this.name = 'AIProviderError';
    this.kind = options.kind;
    this.provider = options.provider;
    this.recoverable = RECOVERABLE_KINDS.has(options.kind);
  }
}

export function isRecoverableKind(kind: AIProviderErrorKind): boolean {
  return RECOVERABLE_KINDS.has(kind);
}

export function toPublicErrorCode(
  kind: AIProviderErrorKind
): DescriptionErrorCode {
  switch (kind) {
    case 'BUDGET_EXCEEDED':
      return 'BUDGET_EXCEEDED';
    case 'SECURITY_BLOCK':
    case 'INVALID_REQUEST':
      return 'INTERNAL_ERROR';
    default:
      return 'PROVIDER_UNAVAILABLE';
  }
}
