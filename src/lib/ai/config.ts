import type { AIProviderName } from './types';

export interface AIProviderConfig {
  readonly name: AIProviderName;
  readonly enabled: boolean;
  readonly apiKey: string | null;
  readonly model: string;
  readonly priority: number;
  readonly timeoutMs: number;
  readonly isPaid: boolean;
}

export interface AIConfig {
  readonly enabled: boolean;
  readonly globalTimeoutMs: number;
  readonly providers: readonly AIProviderConfig[];
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_GLOBAL_TIMEOUT_MS = 25_000;

const DEFAULT_MODELS: Record<AIProviderName, string> = {
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
};

const DEFAULT_PRIORITY: Record<AIProviderName, number> = {
  gemini: 1,
  groq: 2,
  openai: 3,
};

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseTimeout(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

function parsePriority(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

function getApiKey(name: AIProviderName): string | null {
  const envKey = `AI_${name.toUpperCase()}_API_KEY`;
  const value = process.env[envKey];
  if (!value || value.trim() === '') return null;
  return value;
}

function isProviderEnabled(name: AIProviderName, apiKey: string | null): boolean {
  const envKey = `AI_${name.toUpperCase()}_ENABLED`;
  const explicit = process.env[envKey];

  if (name === 'openai') {
    return explicit !== undefined && parseBoolean(explicit, false) && apiKey !== null;
  }

  if (explicit !== undefined) {
    return parseBoolean(explicit, false);
  }
  return apiKey !== null;
}

const PAID_PROVIDERS: ReadonlySet<AIProviderName> = new Set(['openai']);

function buildProviderConfig(name: AIProviderName): AIProviderConfig {
  const apiKey = getApiKey(name);
  const prefix = `AI_${name.toUpperCase()}`;
  return {
    name,
    enabled: isProviderEnabled(name, apiKey),
    apiKey,
    model: process.env[`${prefix}_MODEL`] ?? DEFAULT_MODELS[name],
    priority: parsePriority(process.env[`${prefix}_PRIORITY`], DEFAULT_PRIORITY[name]),
    timeoutMs: parseTimeout(process.env[`${prefix}_TIMEOUT_MS`], DEFAULT_TIMEOUT_MS),
    isPaid: PAID_PROVIDERS.has(name),
  };
}

let cachedConfig: AIConfig | null = null;

export function getAIConfig(): AIConfig {
  if (cachedConfig) return cachedConfig;

  const providers: AIProviderConfig[] = (
    ['gemini', 'groq', 'openai'] as const
  ).map(buildProviderConfig);

  cachedConfig = {
    enabled: parseBoolean(process.env.AI_ENABLED, false),
    globalTimeoutMs: parseTimeout(
      process.env.AI_GLOBAL_TIMEOUT_MS,
      DEFAULT_GLOBAL_TIMEOUT_MS
    ),
    providers,
  };

  return cachedConfig;
}

export function resetAIConfigCache(): void {
  cachedConfig = null;
}

export function getEnabledProviders(): Omit<AIProviderConfig, 'apiKey'>[] {
  return getAIConfig()
    .providers.filter((p) => p.enabled && p.apiKey !== null)
    .sort((a, b) => a.priority - b.priority)
    .map((provider) => {
      const { apiKey, ...rest } = provider;
      void apiKey;
      return rest;
    });
}
