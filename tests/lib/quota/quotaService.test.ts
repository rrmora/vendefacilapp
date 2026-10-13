import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reserveQuota,
  confirmQuota,
  releaseQuota,
  markQuotaSent,
  getQuotaStatus,
  QuotaServiceError,
} from '@/lib/quota/quotaService';
import { setSupabaseClient, resetSupabaseClient } from '@/lib/db/supabaseClient';

function createMockClient(rpcResult: unknown): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
  return { rpc } as unknown as SupabaseClient;
}

function createErrorClient(): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection failed' } });
  return { rpc } as unknown as SupabaseClient;
}

describe('quotaService', () => {
  beforeEach(() => {
    resetSupabaseClient();
    vi.useRealTimers();
  });

  describe('reserveQuota', () => {
    it('reserva exitosamente en primera solicitud', async () => {
      const mockClient = createMockClient({
        status: 'reserved',
        generations_used: 1,
        max_generations: 5,
      });
      setSupabaseClient(mockClient);

      const result = await reserveQuota('550e8400-e29b-41d4-a716-446655440000');

      expect(result.status).toBe('reserved');
      expect(result.status === 'reserved' && result.generationsUsed).toBe(1);
      expect(result.status === 'reserved' && result.maxGenerations).toBe(5);
      expect(result.status === 'reserved' && result.reservationId).toBeDefined();
    });

    it('rechaza cuando se excede la cuota', async () => {
      const mockClient = createMockClient({
        status: 'quota_exceeded',
        generations_used: 5,
        max_generations: 5,
      });
      setSupabaseClient(mockClient);

      const result = await reserveQuota('550e8400-e29b-41d4-a716-446655440000');

      expect(result.status).toBe('quota_exceeded');
      expect(result.status === 'quota_exceeded' && result.generationsUsed).toBe(5);
      expect(result.status === 'quota_exceeded' && result.maxGenerations).toBe(5);
    });

    it('rechaza cuando hay 3 reservas pendientes', async () => {
      const mockClient = createMockClient({
        status: 'rate_limited',
        pending_count: 3,
      });
      setSupabaseClient(mockClient);

      const result = await reserveQuota('550e8400-e29b-41d4-a716-446655440000');

      expect(result.status).toBe('rate_limited');
      expect(result.status === 'rate_limited' && result.pendingCount).toBe(3);
    });

    it('lanza QuotaServiceError cuando Supabase falla', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(reserveQuota('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(QuotaServiceError);
    });

    it('usa fecha de cuota America/Mexico_City', async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: { status: 'reserved', generations_used: 1, max_generations: 5 },
        error: null,
      });
      const mockClient = { rpc } as unknown as SupabaseClient;
      setSupabaseClient(mockClient);

      await reserveQuota('550e8400-e29b-41d4-a716-446655440000');

      const callArgs = rpc.mock.calls[0];
      const quotaDate = callArgs[1].p_quota_date;

      expect(quotaDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('confirmQuota', () => {
    it('confirma reserva exitosamente', async () => {
      const mockClient = createMockClient({ status: 'confirmed' });
      setSupabaseClient(mockClient);

      const result = await confirmQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'confirmed' });
    });

    it('retorna already_processed en confirmación duplicada', async () => {
      const mockClient = createMockClient({
        status: 'already_processed',
        previous_status: 'completed',
      });
      setSupabaseClient(mockClient);

      const result = await confirmQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'already_processed', previousStatus: 'completed' });
    });

    it('retorna not_found cuando la reserva no existe', async () => {
      const mockClient = createMockClient({ status: 'not_found' });
      setSupabaseClient(mockClient);

      const result = await confirmQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('lanza QuotaServiceError cuando Supabase falla', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(confirmQuota('660e8400-e29b-41d4-a716-446655440001')).rejects.toThrow(QuotaServiceError);
    });
  });

  describe('releaseQuota', () => {
    it('libera reserva exitosamente', async () => {
      const mockClient = createMockClient({ status: 'released' });
      setSupabaseClient(mockClient);

      const result = await releaseQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'released' });
    });

    it('retorna already_processed en liberación duplicada', async () => {
      const mockClient = createMockClient({
        status: 'already_processed',
        previous_status: 'completed',
      });
      setSupabaseClient(mockClient);

      const result = await releaseQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'already_processed', previousStatus: 'completed' });
    });

    it('retorna not_found cuando la reserva no existe', async () => {
      const mockClient = createMockClient({ status: 'not_found' });
      setSupabaseClient(mockClient);

      const result = await releaseQuota('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('lanza QuotaServiceError cuando Supabase falla', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(releaseQuota('660e8400-e29b-41d4-a716-446655440001')).rejects.toThrow(QuotaServiceError);
    });
  });

  describe('markQuotaSent', () => {
    it('marca la reserva como enviada correctamente', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: { status: 'sent' }, error: null });
      setSupabaseClient({ rpc } as unknown as SupabaseClient);

      const result = await markQuotaSent('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'sent' });
      expect(rpc).toHaveBeenCalledWith('mark_quota_sent', {
        p_reservation_id: '660e8400-e29b-41d4-a716-446655440001',
      });
    });

    it('retorna already_sent cuando la reserva ya fue enviada', async () => {
      const mockClient = createMockClient({
        status: 'already_sent',
        previous_status: 'sent_uncertain',
      });
      setSupabaseClient(mockClient);

      const result = await markQuotaSent('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({
        status: 'already_sent',
        previousStatus: 'sent_uncertain',
      });
    });

    it('retorna already_processed cuando la reserva ya fue confirmada', async () => {
      const mockClient = createMockClient({
        status: 'already_processed',
        previous_status: 'completed',
      });
      setSupabaseClient(mockClient);

      const result = await markQuotaSent('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'already_processed', previousStatus: 'completed' });
    });

    it('retorna not_found cuando la reserva no existe', async () => {
      const mockClient = createMockClient({ status: 'not_found' });
      setSupabaseClient(mockClient);

      const result = await markQuotaSent('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'not_found' });
    });

    it('reintenta y recupera ante un fallo transitorio', async () => {
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'connection failed' } })
        .mockResolvedValueOnce({ data: { status: 'sent' }, error: null });
      setSupabaseClient({ rpc } as unknown as SupabaseClient);

      const result = await markQuotaSent('660e8400-e29b-41d4-a716-446655440001');

      expect(result).toEqual({ status: 'sent' });
      expect(rpc).toHaveBeenCalledTimes(2);
    });

    it('lanza QuotaServiceError tras agotar los reintentos', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(markQuotaSent('660e8400-e29b-41d4-a716-446655440001')).rejects.toThrow(QuotaServiceError);
      expect((errorClient.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    });
  });

  describe('getQuotaStatus', () => {
    it('retorna estado de cuota correctamente', async () => {
      const mockClient = createMockClient({
        visitor_id: '550e8400-e29b-41d4-a716-446655440000',
        quota_date: '2026-10-12',
        generations_used: 3,
        max_generations: 5,
        pending_reservations: 1,
        remaining: 1,
      });
      setSupabaseClient(mockClient);

      const result = await getQuotaStatus('550e8400-e29b-41d4-a716-446655440000', '2026-10-12');

      expect(result.generationsUsed).toBe(3);
      expect(result.maxGenerations).toBe(5);
      expect(result.pendingReservations).toBe(1);
      expect(result.remaining).toBe(1);
    });

    it('calcula remaining correctamente', async () => {
      const mockClient = createMockClient({
        visitor_id: '550e8400-e29b-41d4-a716-446655440000',
        quota_date: '2026-10-12',
        generations_used: 2,
        max_generations: 5,
        pending_reservations: 2,
        remaining: 1,
      });
      setSupabaseClient(mockClient);

      const result = await getQuotaStatus('550e8400-e29b-41d4-a716-446655440000', '2026-10-12');

      expect(result.remaining).toBe(1);
    });

    it('lanza QuotaServiceError cuando Supabase falla', async () => {
      const errorClient = createErrorClient();
      setSupabaseClient(errorClient);

      await expect(getQuotaStatus('550e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(QuotaServiceError);
    });
  });
});
