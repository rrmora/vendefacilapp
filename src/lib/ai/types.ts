import type { IDescriptionRequest } from '@/types/description';

export type AIProviderName = 'gemini' | 'groq' | 'openai';

export interface AIProviderGenerationRequest {
  category: IDescriptionRequest['category'];
  condition: IDescriptionRequest['condition'];
  pricingType: IDescriptionRequest['pricingType'];
  userNotes: string;
  /**
   * Internal-only regeneration counter: 0 for the first generation and
   * greater than 0 for regenerations. The public contract and the current
   * frontend cannot reliably distinguish each regeneration; changing that
   * requires an approved contract proposal.
   */
  variant: number;
}

export interface AIProviderGenerationResult {
  text: string;
  tokensUsed: number | null;
}

export interface AIProviderCallContext {
  timeoutMs: number;
  remainingMs: number | null;
  abortSignal?: AbortSignal;
}

export interface IAIProvider {
  readonly name: AIProviderName;
  readonly isPaid: boolean;
  generate(
    request: AIProviderGenerationRequest,
    context: AIProviderCallContext
  ): Promise<AIProviderGenerationResult>;
}
