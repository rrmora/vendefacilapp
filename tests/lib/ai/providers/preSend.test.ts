import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildDescriptionPrompt } = vi.hoisted(() => ({
  mockBuildDescriptionPrompt: vi.fn(),
}));

vi.mock('@/lib/ai/prompt', () => ({
  buildDescriptionPrompt: mockBuildDescriptionPrompt,
}));

import { GeminiProvider } from '@/lib/ai/providers/gemini';
import { GroqProvider } from '@/lib/ai/providers/groq';
import { OpenAIProvider } from '@/lib/ai/providers/openai';
import type {
  AIProviderCallContext,
  AIProviderGenerationRequest,
} from '@/lib/ai/types';

const baseRequest: AIProviderGenerationRequest = {
  category: 'electronica',
  condition: 'buen_estado',
  pricingType: 'fijo',
  userNotes: 'iPhone 13 de 128 GB, batería al 85%',
  variant: 0,
};

const baseContext: AIProviderCallContext = {
  timeoutMs: 15_000,
  remainingMs: null,
};

const fetchMock = vi.fn();

const providerCases = [
  {
    name: 'gemini',
    create: () => new GeminiProvider('test-key', 'gemini-2.5-flash'),
  },
  {
    name: 'groq',
    create: () => new GroqProvider('test-key', 'llama-3.3-70b-versatile'),
  },
  {
    name: 'openai',
    create: () => new OpenAIProvider('test-key', 'gpt-4o-mini'),
  },
];

describe.each(providerCases)('$name preparación pre-envío', ({ create }) => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mockBuildDescriptionPrompt.mockReset();
    mockBuildDescriptionPrompt.mockReturnValue({
      systemPrompt: 'system prompt',
      userContent: 'user content',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clasifica un fallo del prompt como pre-envío', async () => {
    mockBuildDescriptionPrompt.mockImplementationOnce(() => {
      throw new Error('prompt preparation failed');
    });

    await expect(create().generate(baseRequest, baseContext)).rejects.toMatchObject({
      name: 'AIProviderError',
      kind: 'PROVIDER_ERROR',
      requestDispatched: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clasifica un fallo de serialización del cuerpo como pre-envío', async () => {
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('body preparation failed');
    });

    await expect(create().generate(baseRequest, baseContext)).rejects.toMatchObject({
      name: 'AIProviderError',
      kind: 'PROVIDER_ERROR',
      requestDispatched: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no clasifica un rechazo de fetch como pre-envío', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(create().generate(baseRequest, baseContext)).rejects.toMatchObject({
      name: 'AIProviderError',
      kind: 'PROVIDER_ERROR',
      requestDispatched: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
