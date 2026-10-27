import type { AIProviderTokenUsage } from './types';

export function normalizeTokenCount(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return null;
  }

  return value;
}

export function createTokenUsage(
  inputTokens: unknown,
  outputTokens: unknown,
  totalTokens: unknown,
  reasoningTokens: unknown
): AIProviderTokenUsage {
  return {
    inputTokens: normalizeTokenCount(inputTokens),
    outputTokens: normalizeTokenCount(outputTokens),
    reasoningTokens: normalizeTokenCount(reasoningTokens),
    totalTokens: normalizeTokenCount(totalTokens),
  };
}

function getKnownBillableOutputTokens(
  usage: AIProviderTokenUsage
): number | null {
  if (usage.outputTokens === null || usage.reasoningTokens === null) {
    return null;
  }

  const billableOutputTokens =
    usage.outputTokens + usage.reasoningTokens;

  return Number.isSafeInteger(billableOutputTokens)
    ? billableOutputTokens
    : null;
}

function hasConsistentTotal(usage: AIProviderTokenUsage): boolean {
  const billableOutputTokens = getKnownBillableOutputTokens(usage);

  if (
    usage.totalTokens === null ||
    usage.inputTokens === null ||
    billableOutputTokens === null
  ) {
    return true;
  }

  return (
    usage.totalTokens >=
    usage.inputTokens + billableOutputTokens
  );
}

export function getBillableOutputTokens(
  usage: AIProviderTokenUsage
): number | null {
  return hasConsistentTotal(usage)
    ? getKnownBillableOutputTokens(usage)
    : null;
}

export function getPublicTotalTokens(
  usage: AIProviderTokenUsage
): number | null {
  return hasConsistentTotal(usage) ? usage.totalTokens : null;
}

export function hasCompleteTokenUsage(usage: AIProviderTokenUsage): boolean {
  return (
    usage.inputTokens !== null &&
    getBillableOutputTokens(usage) !== null
  );
}
