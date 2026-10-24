import { getAIConfig, resetAIConfigCache } from '@/lib/ai/config';

export function authorizeRealCalls(): void {
  process.env.AI_REAL_CALLS_ENABLED = 'true';
  resetAIConfigCache();
}

export function revokeRealCallsAuthorization(): void {
  delete process.env.AI_REAL_CALLS_ENABLED;
  resetAIConfigCache();
}

export function restoreRealCallsEnv(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.AI_REAL_CALLS_ENABLED;
  } else {
    process.env.AI_REAL_CALLS_ENABLED = previous;
  }
  resetAIConfigCache();
}

export function areRealCallsAuthorized(): boolean {
  return getAIConfig().realCallsEnabled;
}
