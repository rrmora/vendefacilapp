import { buildDescriptionPrompt } from '../prompt';
import { AIProviderError } from '../errors';
import { createTokenUsage } from '../tokenUsage';
import { getModelPricing } from '@/lib/budget/budgetService';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
  AIProviderGenerationResult,
  IAIProvider,
} from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    total_tokens?: number | null;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  } | null;
  error?: {
    message?: string;
    type?: string;
  } | null;
}

function classifyHttpError(status: number, response: GroqResponse): AIProviderError {
  const message = response.error?.message ?? `HTTP ${status}`;

  if (status === 400) {
    return new AIProviderError({
      kind: 'INVALID_REQUEST',
      provider: 'groq',
      message,
    });
  }
  if (status === 401) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'groq',
      message,
    });
  }
  if (status === 403 && /safety|block|policy/i.test(message)) {
    return new AIProviderError({
      kind: 'SECURITY_BLOCK',
      provider: 'groq',
      message,
    });
  }
  if (status === 403) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'groq',
      message,
    });
  }
  if (status === 429) {
    return new AIProviderError({
      kind: 'RATE_LIMITED',
      provider: 'groq',
      message,
    });
  }
  if (status >= 500) {
    return new AIProviderError({
      kind: 'PROVIDER_ERROR',
      provider: 'groq',
      message,
    });
  }
  return new AIProviderError({
    kind: 'PROVIDER_ERROR',
    provider: 'groq',
    message,
  });
}

function extractText(response: GroqResponse): string {
  return (response.choices?.[0]?.message?.content ?? '').trim();
}

function extractUsage(response: GroqResponse) {
  return createTokenUsage(
    response.usage?.prompt_tokens,
    response.usage?.completion_tokens,
    response.usage?.total_tokens,
    0
  );
}

export class GroqProvider implements IAIProvider {
  readonly name = 'groq' as const;
  readonly isPaid = false;

  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(
    request: AIProviderGenerationRequest,
    context: AIProviderCallContext
  ): Promise<AIProviderGenerationResult> {
    let requestDispatched = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const controller = new AbortController();
    const onAbort = () => controller.abort();

    try {
      const pricing = getModelPricing(this.model);
      if (!pricing) {
        throw new AIProviderError({
          kind: 'NOT_CONFIGURED',
          provider: 'groq',
          message: 'Model is not configured with an output token limit',
          requestDispatched: false,
        });
      }

      const { systemPrompt, userContent } = buildDescriptionPrompt(request);
      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: pricing.maxOutputTokens,
      });

      timeoutId = setTimeout(() => controller.abort(), context.timeoutMs);

      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', onAbort, { once: true });

        if (context.abortSignal.aborted) {
          throw new AIProviderError({
            kind: 'PROVIDER_ERROR',
            provider: 'groq',
            message: 'Request aborted by client',
            requestDispatched: false,
          });
        }
      }

      // Only this assignment marks the request as dispatched. Any failure
      // before it is local preparation and cannot have consumed inference.
      requestDispatched = true;

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: GroqResponse = {};
        try {
          errorBody = (await response.json()) as GroqResponse;
        } catch {
        }
        throw classifyHttpError(response.status, errorBody);
      }

      let data: GroqResponse;
      try {
        data = (await response.json()) as GroqResponse;
      } catch {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'groq',
          message: 'Invalid JSON response',
        });
      }

      const text = extractText(data);
      if (!text) {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'groq',
          message: 'Empty response from provider',
        });
      }

      return { text, usage: extractUsage(data) };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'groq',
          message: 'Request timed out or was aborted',
          requestDispatched,
        });
      }
      throw new AIProviderError({
        kind: 'PROVIDER_ERROR',
        provider: 'groq',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestDispatched,
      });
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (context.abortSignal) {
        context.abortSignal.removeEventListener('abort', onAbort);
      }
    }
  }
}
