import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAIConfig,
  getEnabledProviders,
  resetAIConfigCache,
} from '@/lib/ai/config';

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_GLOBAL_TIMEOUT_MS',
  'AI_GEMINI_API_KEY',
  'AI_GEMINI_ENABLED',
  'AI_GEMINI_MODEL',
  'AI_GEMINI_PRIORITY',
  'AI_GEMINI_TIMEOUT_MS',
  'AI_GROQ_API_KEY',
  'AI_GROQ_ENABLED',
  'AI_GROQ_MODEL',
  'AI_GROQ_PRIORITY',
  'AI_GROQ_TIMEOUT_MS',
  'AI_OPENAI_API_KEY',
  'AI_OPENAI_ENABLED',
  'AI_OPENAI_MODEL',
  'AI_OPENAI_PRIORITY',
  'AI_OPENAI_TIMEOUT_MS',
] as const;

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetAIConfigCache();
});

describe('getAIConfig', () => {
  it('devuelve AI_ENABLED=false por defecto', () => {
    expect(getAIConfig().enabled).toBe(false);
  });

  it('respeta AI_ENABLED=true', () => {
    process.env.AI_ENABLED = 'true';
    expect(getAIConfig().enabled).toBe(true);
  });

  it('ignora valores inválidos de AI_ENABLED', () => {
    process.env.AI_ENABLED = 'maybe';
    expect(getAIConfig().enabled).toBe(false);
  });

  it('usa timeout global de 25s por defecto', () => {
    expect(getAIConfig().globalTimeoutMs).toBe(25_000);
  });

  it('respeta AI_GLOBAL_TIMEOUT_MS válido', () => {
    process.env.AI_GLOBAL_TIMEOUT_MS = '30000';
    expect(getAIConfig().globalTimeoutMs).toBe(30_000);
  });

  it('ignora AI_GLOBAL_TIMEOUT_MS inválido', () => {
    process.env.AI_GLOBAL_TIMEOUT_MS = '-5';
    expect(getAIConfig().globalTimeoutMs).toBe(25_000);
  });

  it('incluye los tres proveedores con prioridad por defecto', () => {
    const config = getAIConfig();

    expect(config.providers).toHaveLength(3);
    expect(config.providers.map((p) => p.name)).toEqual([
      'gemini',
      'groq',
      'openai',
    ]);
    expect(config.providers.map((p) => p.priority)).toEqual([1, 2, 3]);
  });

  it('desactiva proveedores sin API key por defecto', () => {
    const config = getAIConfig();

    for (const provider of config.providers) {
      expect(provider.enabled).toBe(false);
      expect(provider.apiKey).toBeNull();
    }
  });

  it('activa proveedor cuando tiene API key', () => {
    process.env.AI_GEMINI_API_KEY = 'test-key-123';
    const gemini = getAIConfig().providers.find((p) => p.name === 'gemini');

    expect(gemini?.enabled).toBe(true);
    expect(gemini?.apiKey).toBe('test-key-123');
  });

  it('usa modelos por defecto documentados', () => {
    const config = getAIConfig();

    expect(config.providers.find((p) => p.name === 'gemini')?.model).toBe(
      'gemini-2.5-flash'
    );
    expect(config.providers.find((p) => p.name === 'groq')?.model).toBe(
      'llama-3.3-70b-versatile'
    );
    expect(config.providers.find((p) => p.name === 'openai')?.model).toBe(
      'gpt-4o-mini'
    );
  });

  it('permite sobrescribir modelo, timeout y prioridad por proveedor', () => {
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.AI_GEMINI_MODEL = 'custom-model';
    process.env.AI_GEMINI_TIMEOUT_MS = '10000';
    process.env.AI_GEMINI_PRIORITY = '5';

    const gemini = getAIConfig().providers.find((p) => p.name === 'gemini');

    expect(gemini?.model).toBe('custom-model');
    expect(gemini?.timeoutMs).toBe(10_000);
    expect(gemini?.priority).toBe(5);
  });

  it('respeta AI_GEMINI_ENABLED=false aunque exista API key', () => {
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.AI_GEMINI_ENABLED = 'false';

    const gemini = getAIConfig().providers.find((p) => p.name === 'gemini');

    expect(gemini?.enabled).toBe(false);
  });

  it('no expone API keys a través de getEnabledProviders', () => {
    process.env.AI_GEMINI_API_KEY = 'secret-key';

    const serialized = JSON.stringify(getEnabledProviders());

    expect(serialized).not.toContain('secret-key');
  });
});

describe('getEnabledProviders', () => {
  it('devuelve lista vacía cuando no hay proveedores habilitados', () => {
    expect(getEnabledProviders()).toEqual([]);
  });

  it('devuelve proveedores habilitados ordenados por prioridad', () => {
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';
    process.env.AI_OPENAI_PRIORITY = '1';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GEMINI_PRIORITY = '2';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_GROQ_PRIORITY = '3';

    expect(getEnabledProviders().map((p) => p.name)).toEqual([
      'openai',
      'gemini',
      'groq',
    ]);
  });

  it('excluye proveedores sin API key aunque estén habilitados', () => {
    process.env.AI_GEMINI_ENABLED = 'true';
    process.env.AI_GROQ_API_KEY = 'groq-key';

    expect(getEnabledProviders().map((p) => p.name)).toEqual(['groq']);
  });
});

describe('T-005.1 política de proveedores gratuitos y de pago', () => {
  it('clasifica Gemini y Groq como gratuitos para presupuesto', () => {
    const providers = getAIConfig().providers;

    expect(providers.find((p) => p.name === 'gemini')?.isPaid).toBe(false);
    expect(providers.find((p) => p.name === 'groq')?.isPaid).toBe(false);
  });

  it('clasifica OpenAI como proveedor de pago', () => {
    const openai = getAIConfig().providers.find((p) => p.name === 'openai');

    expect(openai?.isPaid).toBe(true);
  });

  it('mantiene OpenAI deshabilitado con API key si falta AI_OPENAI_ENABLED', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_OPENAI_API_KEY = 'openai-key';

    const openai = getAIConfig().providers.find((p) => p.name === 'openai');

    expect(openai?.enabled).toBe(false);
  });

  it('habilita OpenAI con API key y AI_OPENAI_ENABLED=true', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    const openai = getAIConfig().providers.find((p) => p.name === 'openai');

    expect(openai?.enabled).toBe(true);
  });

  it('mantiene OpenAI deshabilitado con AI_OPENAI_ENABLED=false', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'false';

    const openai = getAIConfig().providers.find((p) => p.name === 'openai');

    expect(openai?.enabled).toBe(false);
  });

  it('conserva el orden predeterminado Gemini, Groq, OpenAI', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_GEMINI_API_KEY = 'gemini-key';
    process.env.AI_GROQ_API_KEY = 'groq-key';
    process.env.AI_OPENAI_API_KEY = 'openai-key';
    process.env.AI_OPENAI_ENABLED = 'true';

    expect(getEnabledProviders().map((p) => p.name)).toEqual([
      'gemini',
      'groq',
      'openai',
    ]);
  });
});
