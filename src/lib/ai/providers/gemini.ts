import { buildDescriptionPrompt } from '../prompt';
import { AIProviderError } from '../errors';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
  AIProviderGenerationResult,
  IAIProvider,
} from '../types';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function classifyHttpError(status: number, response: GeminiResponse): AIProviderError {
  const message = response.error?.message ?? `HTTP ${status}`;

  if (status === 400) {
    return new AIProviderError({
      kind: 'INVALID_REQUEST',
      provider: 'gemini',
      message,
    });
  }
  if (status === 401) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'gemini',
      message,
    });
  }
  if (status === 403 && /safety|block|policy/i.test(message)) {
    return new AIProviderError({
      kind: 'SECURITY_BLOCK',
      provider: 'gemini',
      message,
    });
  }
  if (status === 403) {
    return new AIProviderError({
      kind: 'AUTH_ERROR',
      provider: 'gemini',
      message,
    });
  }
  if (status === 429) {
    return new AIProviderError({
      kind: 'RATE_LIMITED',
      provider: 'gemini',
      message,
    });
  }
  if (status >= 500) {
    return new AIProviderError({
      kind: 'PROVIDER_ERROR',
      provider: 'gemini',
      message,
    });
  }
  return new AIProviderError({
    kind: 'PROVIDER_ERROR',
    provider: 'gemini',
    message,
  });
}

function extractText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('').trim();
}

function extractTokens(response: GeminiResponse): number | null {
  const usage = response.usageMetadata;
  if (!usage) return null;
  return usage.totalTokenCount ?? usage.promptTokenCount ?? null;
}

export class GeminiProvider implements IAIProvider {
  readonly name = 'gemini' as const;
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
      const url = `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userContent }] }],
      });

      timeoutId = setTimeout(() => controller.abort(), context.timeoutMs);

      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', onAbort, { once: true });

        if (context.abortSignal.aborted) {
          throw new AIProviderError({
            kind: 'PROVIDER_ERROR',
            provider: 'gemini',
            message: 'Request aborted by client',
            requestDispatched: false,
          });
        }
      }

      // Only this assignment marks the request as dispatched. Any failure
      // before it is local preparation and cannot have consumed inference.
      requestDispatched = true;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorBody: GeminiResponse = {};
        try {
          errorBody = (await response.json()) as GeminiResponse;
        } catch {
        }
        throw classifyHttpError(response.status, errorBody);
      }

      let data: GeminiResponse;
      try {
        data = (await response.json()) as GeminiResponse;
      } catch {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'gemini',
          message: 'Invalid JSON response',
        });
      }

      const text = extractText(data);
      if (!text) {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'gemini',
          message: 'Empty response from provider',
        });
      }

      return { text, tokensUsed: extractTokens(data) };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIProviderError({
          kind: 'PROVIDER_ERROR',
          provider: 'gemini',
          message: 'Request timed out or was aborted',
          requestDispatched,
        });
      }
      throw new AIProviderError({
        kind: 'PROVIDER_ERROR',
        provider: 'gemini',
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
