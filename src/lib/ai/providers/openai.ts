import { buildDescriptionPrompt } from '../prompt';
import { AIProviderError } from '../errors';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
  AIProviderGenerationResult,
  IAIProvider,
} from '../types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIResponse {
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
    code?: string | null;
  } | null;
}

function classifyHttpError(status: number, response: OpenAIResponse): AIProviderError {
  const message = response.error?.message ?? `HTTP ${status}`;
  const code = response.error?.code ?? '';
  const type = response.error?.type ?? '';

  if (status === 400) {
    return new AIProviderError({
      kind: 'INVALID_REQUEST',
      provider: 'openai',
      message,
    });
  }
  if (status === 401) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'openai',
      message,
    });
  }
  if (status === 403 && /safety|block|policy/i.test(message)) {
    return new AIProviderError({
      kind: 'SECURITY_BLOCK',
      provider: 'openai',
      message,
    });
  }
  if (status === 403) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'openai',
      message,
    });
  }
  if (status === 429) {
    if (/quota|billing|insufficient/i.test(message) || code === 'insufficient_quota') {
      return new AIProviderError({
        kind: 'BUDGET_EXCEEDED',
        provider: 'openai',
        message,
      });
    }
    if (/rate.?limit/i.test(message) || type === 'rate_limit_exceeded') {
      return new AIProviderError({
        kind: 'RATE_LIMITED',
        provider: 'openai',
        message,
      });
    }
    return new AIProviderError({
      kind: 'RATE_LIMITED',
      provider: 'openai',
      message,
    });
  }
  if (status >= 500) {
    return new AIProviderError({
      kind: 'PROVIDER_ERROR',
      provider: 'openai',
      message,
    });
  }
  return new AIProviderError({
    kind: 'PROVIDER_ERROR',
    provider: 'openai',
    message,
  });
}

function extractText(response: OpenAIResponse): string {
  return (response.choices?.[0]?.message?.content ?? '').trim();
}

function extractTokens(response: OpenAIResponse): number | null {
  const usage = response.usage;
  if (!usage) return null;
  return usage.total_tokens ?? usage.prompt_tokens ?? null;
}

export class OpenAIProvider implements IAIProvider {
  readonly name = 'openai' as const;
  readonly isPaid = true;

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
      const { systemPrompt, userContent } = buildDescriptionPrompt(request);
      const body = JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      });

      timeoutId = setTimeout(() => controller.abort(), context.timeoutMs);

      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', onAbort, { once: true });

        if (context.abortSignal.aborted) {
          throw new AIProviderError({
            kind: 'PROVIDER_ERROR',
            provider: 'openai',
            message: 'Request aborted by client',
            requestDispatched: false,
          });
        }
      }

      // Only this assignment marks the request as dispatched. Any failure
      // before it is local preparation and cannot have consumed inference.
      requestDispatched = true;

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: OpenAIResponse = {};
        try {
          errorBody = (await response.json()) as OpenAIResponse;
        } catch {
        }
        throw classifyHttpError(response.status, errorBody);
      }

      let data: OpenAIResponse;
      try {
        data = (await response.json()) as OpenAIResponse;
      } catch {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'openai',
          message: 'Invalid JSON response',
        });
      }

      const text = extractText(data);
      if (!text) {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'openai',
          message: 'Empty response from provider',
        });
      }

      return { text, tokensUsed: extractTokens(data) };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'openai',
          message: 'Request timed out or was aborted',
          requestDispatched,
        });
      }
      throw new AIProviderError({
        kind: 'PROVIDER_ERROR',
        provider: 'openai',
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
