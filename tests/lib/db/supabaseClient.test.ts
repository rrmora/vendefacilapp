import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseConfigError,
  isSupabaseConfigured,
  setSupabaseClient,
  getSupabaseClient,
  callRpc,
  resetSupabaseClient,
} from '@/lib/db/supabaseClient';

describe('supabaseClient', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    resetSupabaseClient();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.SUPABASE_URL = originalUrl;
    }
    if (originalKey !== undefined) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
    resetSupabaseClient();
  });

  describe('isSupabaseConfigured', () => {
    it('retorna false cuando faltan credenciales', () => {
      expect(isSupabaseConfigured()).toBe(false);
    });

    it('retorna false cuando solo falta URL', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';

      expect(isSupabaseConfigured()).toBe(false);
    });

    it('retorna false cuando solo falta key', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';

      expect(isSupabaseConfigured()).toBe(false);
    });

    it('retorna true cuando ambas credenciales están presentes', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';

      expect(isSupabaseConfigured()).toBe(true);
    });
  });

  describe('getSupabaseClient', () => {
    it('lanza SupabaseConfigError cuando no está configurado', () => {
      expect(() => getSupabaseClient()).toThrow(SupabaseConfigError);
    });

    it('menciona variables faltantes en el error', () => {
      try {
        getSupabaseClient();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(SupabaseConfigError);
        expect((error as Error).message).toContain('SUPABASE_URL');
        expect((error as Error).message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      }
    });

    it('retorna cliente cuando está configurado', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';

      const client = getSupabaseClient();

      expect(client).toBeDefined();
    });

    it('reutiliza la misma instancia', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';

      const first = getSupabaseClient();
      const second = getSupabaseClient();

      expect(first).toBe(second);
    });

    it('usa cliente inyectado cuando existe', () => {
      const mockClient = { injected: true } as unknown as SupabaseClient;
      setSupabaseClient(mockClient);

      expect(getSupabaseClient()).toBe(mockClient);
    });
  });

  describe('callRpc', () => {
    it('lanza error cuando Supabase no está configurado', async () => {
      await expect(callRpc('test_fn')).rejects.toThrow(SupabaseConfigError);
    });

    it('ejecuta RPC y retorna data', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { result: 42 },
        error: null,
      });
      const mockClient = { rpc: mockRpc } as unknown as SupabaseClient;
      setSupabaseClient(mockClient);

      const result = await callRpc<{ result: number }>('test_fn', { param: 1 });

      expect(mockRpc).toHaveBeenCalledWith('test_fn', { param: 1 });
      expect(result).toEqual({ result: 42 });
    });

    it('lanza error cuando RPC falla', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'constraint violation' },
      });
      const mockClient = { rpc: mockRpc } as unknown as SupabaseClient;
      setSupabaseClient(mockClient);

      await expect(callRpc('test_fn')).rejects.toThrow('constraint violation');
    });
  });

  describe('aislamiento de credenciales', () => {
    it('las credenciales se leen dinámicamente del proceso servidor', () => {
      process.env.SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-key-123';

      const client = getSupabaseClient();

      expect(client).toBeDefined();
    });

    it('no usa prefijo NEXT_PUBLIC_ para secretos', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'public-url';
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = 'public-key';
      process.env.SUPABASE_URL = 'https://private.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-key';

      const client = getSupabaseClient();

      expect(client).toBeDefined();
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
    });
  });
});
