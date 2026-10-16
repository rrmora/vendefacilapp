import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkRateLimit,
  normalizeIpAddress,
  extractClientIp,
  RateLimiterError,
  setSupabaseClient,
  resetSupabaseClient,
} from '@/lib/ratelimit/rateLimiter';

function createMockClient(rpcResult: unknown): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
  return { rpc } as unknown as SupabaseClient;
}

function createErrorClient(): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection failed' } });
  return { rpc } as unknown as SupabaseClient;
}

describe('rateLimiter', () => {
  beforeEach(() => {
    resetSupabaseClient();
    delete process.env.TRUST_PROXY;
    delete process.env.TRUSTED_PROXIES;
  });

  describe('normalizeIpAddress', () => {
    it('acepta IPv4 válido', () => {
      expect(normalizeIpAddress('192.168.1.10')).toBe('192.168.1.10');
    });

    it('acepta IPv6 válido', () => {
      expect(normalizeIpAddress('2001:db8::1')).toBe('2001:db8::1');
    });

    it('rechaza valor inválido', () => {
      expect(normalizeIpAddress('not-an-ip')).toBeNull();
      expect(normalizeIpAddress('999.1.1.1')).toBeNull();
      expect(normalizeIpAddress(null)).toBeNull();
    });
  });

  describe('extractClientIp', () => {
    it('retorna null sin proxy confiable', () => {
      const request = {
        headers: { get: () => '10.0.0.1' },
      } as unknown as { headers: { get: (name: string) => string | null } };

      expect(extractClientIp(request as never)).toBeNull();
    });

    it('usa proxy confiable por opción', () => {
      const request = {
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'x-real-ip' ? '192.168.0.5' : null,
        },
      } as unknown as { headers: { get: (name: string) => string | null } };

      expect(extractClientIp(request as never, { trustedProxy: true })).toBe('192.168.0.5');
    });

    it('resuelve el último salto confiable en X-Forwarded-For', () => {
      const request = {
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'x-forwarded-for'
              ? '203.0.113.9, 10.0.0.2, 172.16.0.3'
              : null,
        },
      } as unknown as { headers: { get: (name: string) => string | null } };

      expect(
        extractClientIp(request as never, { trustedProxy: true, trustedProxyHops: 2 })
      ).toBe('10.0.0.2');
    });

    it('rechaza IP ausente', () => {
      const request = {
        headers: { get: () => null },
      } as unknown as { headers: { get: (name: string) => string | null } };

      expect(extractClientIp(request as never, { trustedProxy: true })).toBeNull();
    });
  });

  describe('checkRateLimit', () => {
    it('permite solicitudes dentro del límite', async () => {
      const mockClient = createMockClient({
        status: 'allowed',
        counts: { minute: 1, hour: 1, day: 1 },
        limits: { minute: 10, hour: 100, day: 500 },
      });
      setSupabaseClient(mockClient);

      const result = await checkRateLimit('198.51.100.10');

      expect(result.status).toBe('allowed');
      expect(result.status === 'allowed' && result.counts.minute).toBe(1);
    });

    it('rechaza cuando se excede el límite por minuto', async () => {
      const mockClient = createMockClient({
        status: 'rate_limited',
        window: 'minute',
        limit: 10,
        current: 10,
        retry_after_seconds: 42,
      });
      setSupabaseClient(mockClient);

      const result = await checkRateLimit('198.51.100.10');

      expect(result.status).toBe('rate_limited');
      expect(result.status === 'rate_limited' && result.window).toBe('minute');
      expect(result.status === 'rate_limited' && result.retryAfterSeconds).toBe(42);
    });

    it('retorna invalid_ip sin llamar a Supabase', async () => {
      const mockClient = createMockClient({ status: 'allowed' });
      setSupabaseClient(mockClient);

      const result = await checkRateLimit('not-an-ip');

      expect(result.status).toBe('invalid_ip');
      expect(mockClient.rpc).not.toHaveBeenCalled();
    });

    it('lanza RateLimiterError cuando Supabase falla', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(checkRateLimit('198.51.100.10')).rejects.toThrow(RateLimiterError);
    });

    it('invoca la RPC check_rate_limit con el contrato esperado', async () => {
      const mockClient = createMockClient({
        status: 'allowed',
        counts: { minute: 1, hour: 1, day: 1 },
        limits: { minute: 10, hour: 100, day: 500 },
      });
      setSupabaseClient(mockClient);

      await checkRateLimit('198.51.100.10');

      expect(mockClient.rpc).toHaveBeenCalledWith('check_rate_limit', {
        p_ip_address: '198.51.100.10',
      });
    });

    it('mapea el rejection de la ventana movil sin alterar el contrato', async () => {
      const mockClient = createMockClient({
        status: 'rate_limited',
        window: 'day',
        limit: 500,
        current: 500,
        retry_after_seconds: 3600,
      });
      setSupabaseClient(mockClient);

      const result = await checkRateLimit('198.51.100.10');

      expect(result).toEqual({
        status: 'rate_limited',
        window: 'day',
        limit: 500,
        current: 500,
        retryAfterSeconds: 3600,
      });
    });
  });
});