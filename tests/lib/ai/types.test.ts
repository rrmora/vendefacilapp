import { describe, expect, it } from 'vitest';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
  AIProviderGenerationResult,
  IAIProvider,
} from '@/lib/ai/types';

const fakeProvider: IAIProvider = {
  name: 'gemini',
  isPaid: false,
  async generate(
    request: AIProviderGenerationRequest,
    context: AIProviderCallContext
  ): Promise<AIProviderGenerationResult> {
    const deadline =
      context.remainingMs === null ? 'sin-limite' : `limite-${context.remainingMs}`;

    return {
      text: `[FAKE] ${request.category}/${request.condition}/v${request.variant}/${deadline}`,
      usage: {
        inputTokens: request.userNotes.length,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: request.userNotes.length,
      },
    };
  },
};

describe('contrato IAIProvider', () => {
  it('admite un proveedor simulado que respeta el contrato interno', async () => {
    const request: AIProviderGenerationRequest = {
      category: 'electronica',
      condition: 'buen_estado',
      pricingType: 'fijo',
      userNotes: 'iPhone 13 de 128 GB',
      variant: 1,
    };
    const context: AIProviderCallContext = {
      timeoutMs: 15000,
      remainingMs: 25000,
    };

    const result = await fakeProvider.generate(request, context);

    expect(result.text).toContain('electronica/buen_estado/v1/limite-25000');
    expect(result.usage).toEqual({
      inputTokens: 19,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 19,
    });
  });

  it('expone el nombre y la naturaleza de pago del proveedor', () => {
    expect(fakeProvider.name).toBe('gemini');
    expect(fakeProvider.isPaid).toBe(false);
  });
});
