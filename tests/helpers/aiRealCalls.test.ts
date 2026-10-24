import { afterEach, describe, expect, it } from 'vitest';
import { getAIConfig, resetAIConfigCache } from '@/lib/ai/config';
import { restoreRealCallsEnv } from './aiRealCalls';

const originalRealCallsEnv = process.env.AI_REAL_CALLS_ENABLED;

afterEach(() => {
  restoreRealCallsEnv(originalRealCallsEnv);
});

describe('restoreRealCallsEnv', () => {
  it('restaura la ausencia original', () => {
    process.env.AI_REAL_CALLS_ENABLED = 'true';

    restoreRealCallsEnv(undefined);

    expect(process.env.AI_REAL_CALLS_ENABLED).toBeUndefined();
  });

  it('restaura el valor true original', () => {
    process.env.AI_REAL_CALLS_ENABLED = 'false';

    restoreRealCallsEnv('true');

    expect(process.env.AI_REAL_CALLS_ENABLED).toBe('true');
  });

  it('restaura cualquier otro valor original', () => {
    process.env.AI_REAL_CALLS_ENABLED = 'true';

    restoreRealCallsEnv('legacy');

    expect(process.env.AI_REAL_CALLS_ENABLED).toBe('legacy');
  });

  it('restablece la cache de configuracion al restaurar', () => {
    process.env.AI_REAL_CALLS_ENABLED = 'true';
    resetAIConfigCache();
    expect(getAIConfig().realCallsEnabled).toBe(true);

    restoreRealCallsEnv(undefined);

    expect(getAIConfig().realCallsEnabled).toBe(false);
  });
});
