import { isIP } from 'net';
import { callRpc } from '@/lib/db/supabaseClient';

export const RATE_LIMITS = {
  minute: { windowMs: 60_000, maxRequests: 10 },
  hour: { windowMs: 3_600_000, maxRequests: 100 },
  day: { windowMs: 86_400_000, maxRequests: 500 },
} as const;

export type RateLimitWindow = keyof typeof RATE_LIMITS;

export type RateLimitResult =
  | {
      status: 'allowed';
      counts: Record<RateLimitWindow, number>;
      limits: Record<RateLimitWindow, number>;
    }
  | {
      status: 'rate_limited';
      window: RateLimitWindow;
      limit: number;
      current: number;
      retryAfterSeconds: number;
    }
  | { status: 'invalid_ip' };

export class RateLimiterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimiterError';
  }
}

export function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 45) {
    return null;
  }

  return isIP(trimmed) ? trimmed : null;
}

export interface ClientIpExtractionOptions {
  trustedProxy?: boolean;
  trustedProxyHops?: number;
}

type HeaderSource =
  | Headers
  | { headers?: Headers | Record<string, string> | null; ip?: string | null };

function readHeader(source: HeaderSource, name: string): string | null {
  let headers: Headers | Record<string, string> | null | undefined;

  if (source instanceof Headers) {
    headers = source;
  } else {
    headers = source.headers ?? null;
  }

  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as unknown as { get: (name: string) => string | null }).get(name);
  }

  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === lowerName);
  return key ? String(headers[key] ?? '') : null;
}

function isTrustedProxyOption(options?: ClientIpExtractionOptions): boolean {
  if (options?.trustedProxy !== undefined) {
    return options.trustedProxy;
  }

  return (
    process.env.TRUST_PROXY === 'true' ||
    process.env.TRUST_PROXY === '1' ||
    process.env.TRUSTED_PROXIES === 'true'
  );
}

export function extractClientIp(
  source: HeaderSource,
  options?: ClientIpExtractionOptions
): string | null {
  if (source instanceof Object && 'ip' in source && source.ip) {
    const normalizedPlatformIp = normalizeIpAddress(source.ip);
    if (normalizedPlatformIp) {
      return normalizedPlatformIp;
    }
  }

  if (!isTrustedProxyOption(options)) {
    return null;
  }

  const trustedHeaders = [
    'cf-connecting-ip',
    'true-client-ip',
    'x-client-ip',
    'x-real-ip',
  ];

  for (const header of trustedHeaders) {
    const normalized = normalizeIpAddress(readHeader(source, header));
    if (normalized) {
      return normalized;
    }
  }

  const forwarded = readHeader(source, 'x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const hops = Math.max(1, options?.trustedProxyHops ?? 1);
    const index = Math.max(0, entries.length - hops);

    if (entries[index]) {
      const normalized = normalizeIpAddress(entries[index]);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

export async function checkRateLimit(ip: string): Promise<RateLimitResult> {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    return { status: 'invalid_ip' };
  }

  try {
    const result = await callRpc<{
      status: string;
      window?: string;
      limit?: number;
      current?: number;
      retry_after_seconds?: number;
      counts?: Record<string, number>;
      limits?: Record<string, number>;
    }>('check_rate_limit', {
      p_ip_address: normalizedIp,
    });

    if (result.status === 'allowed') {
      return {
        status: 'allowed',
        counts: {
          minute: result.counts?.minute ?? 0,
          hour: result.counts?.hour ?? 0,
          day: result.counts?.day ?? 0,
        },
        limits: {
          minute: result.limits?.minute ?? RATE_LIMITS.minute.maxRequests,
          hour: result.limits?.hour ?? RATE_LIMITS.hour.maxRequests,
          day: result.limits?.day ?? RATE_LIMITS.day.maxRequests,
        },
      };
    }

    const window = (result.window ?? 'minute') as RateLimitWindow;
    return {
      status: 'rate_limited',
      window,
      limit: result.limit ?? RATE_LIMITS[window].maxRequests,
      current: result.current ?? 0,
      retryAfterSeconds: result.retry_after_seconds ?? 1,
    };
  } catch (error) {
    throw new RateLimiterError(
      `No se pudo verificar rate limit: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export { setSupabaseClient, resetSupabaseClient } from '@/lib/db/supabaseClient';