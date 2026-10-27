import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reserveBudget,
  confirmBudget,
  releaseBudget,
  getBudgetStatus,
  calculateActualCostUsd,
  calculateMaxCostUsd,
  getBudgetMonth,
  getModelPricing,
  BudgetServiceError,
  setSupabaseClient,
  resetSupabaseClient,
} from '@/lib/budget/budgetService';

function createMockClient(rpcResult: unknown): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null });
  return { rpc } as unknown as SupabaseClient;
}

function createErrorClient(): SupabaseClient {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection failed' } });
  return { rpc } as unknown as SupabaseClient;
}

function requirePricing(model: string) {
  const pricing = getModelPricing(model);
  if (!pricing) {
    throw new Error(`Missing pricing for ${model}`);
  }
  return pricing;
}

describe('budgetService', () => {
  beforeEach(() => {
    resetSupabaseClient();
    delete process.env.AI_MONTHLY_BUDGET_USD;
    delete process.env.AI_MAX_TOKENS_DEFAULT_INPUT;
    delete process.env.AI_MAX_TOKENS_DEFAULT_OUTPUT;
  });

  describe('reserveBudget', () => {
    it('reserva dentro del presupuesto', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'reserved',
          month: '2026-10',
          reserved_cost_usd: 0.001843,
          spent_usd: 0,
          reserved_usd: 0.001843,
          total_budget_usd: 5,
        })
      );

      const result = await reserveBudget({ maxCostUsd: 0.001843 });

      expect(result.status).toBe('reserved');
      expect(result.status === 'reserved' && result.reservedCostUsd).toBe(0.001843);
    });

    it('rechaza cuando no hay presupuesto suficiente', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'budget_exceeded',
          month: '2026-10',
          spent_usd: 4.76,
          reserved_usd: 0.01,
          total_budget_usd: 5,
          available_usd: 0,
        })
      );

      const result = await reserveBudget({ maxCostUsd: 0.2 });

      expect(result.status).toBe('budget_exceeded');
      expect(result.status === 'budget_exceeded' && result.availableUsd).toBe(0);
    });

    it('retorna already_reserved para idempotencia', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'already_reserved',
          month: '2026-10',
          reserved_cost_usd: 0.002,
          spent_usd: 0,
          reserved_usd: 0.002,
          total_budget_usd: 5,
        })
      );

      const result = await reserveBudget({ maxCostUsd: 0.002, reservationId: '00000000-0000-4000-8000-000000000001' });

      expect(result.status).toBe('already_reserved');
    });

    it('lanza BudgetServiceError cuando Supabase falla', async () => {
      setSupabaseClient(createErrorClient());

      await expect(reserveBudget({ maxCostUsd: 0.01 })).rejects.toThrow(BudgetServiceError);
    });
  });

  describe('confirmBudget', () => {
    it('confirma costo real', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'confirmed',
          month: '2026-10',
          reserved_cost_usd: 0.001843,
          actual_cost_usd: 0.0012,
          cost_estimated: false,
        })
      );

      const result = await confirmBudget({
        reservationId: '00000000-0000-4000-8000-000000000001',
        actualCostUsd: 0.0012,
      });

      expect(result.status).toBe('confirmed');
      expect(result.status === 'confirmed' && result.actualCostUsd).toBe(0.0012);
      expect(result.status === 'confirmed' && result.exceedsReservation).toBe(
        false
      );
    });

    it('señala el exceso sin alterar el costo confirmado', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'confirmed',
          month: '2026-10',
          reserved_cost_usd: 0.001,
          actual_cost_usd: 0.0012,
          cost_estimated: false,
        })
      );

      const result = await confirmBudget({
        reservationId: '00000000-0000-4000-8000-000000000001',
        actualCostUsd: 0.0012,
      });

      expect(result.status).toBe('confirmed');
      if (result.status === 'confirmed') {
        expect(result.actualCostUsd).toBe(0.0012);
        expect(result.exceedsReservation).toBe(true);
        expect(result.excessCostUsd).toBe(0.0002);
      }
    });

    it('es idempotente', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'already_processed',
          previous_status: 'confirmed',
        })
      );

      const result = await confirmBudget({
        reservationId: '00000000-0000-4000-8000-000000000001',
        actualCostUsd: 0.0012,
      });

      expect(result.status).toBe('already_processed');
      expect(result.status === 'already_processed' && result.previousStatus).toBe('confirmed');
    });

    it('retorna not_found para reserva inexistente', async () => {
      setSupabaseClient(createMockClient({ status: 'not_found' }));

      const result = await confirmBudget({
        reservationId: '00000000-0000-4000-8000-000000000002',
        actualCostUsd: 0.0012,
      });

      expect(result.status).toBe('not_found');
    });
  });

  describe('releaseBudget', () => {
    it('libera reserva pendiente', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'released',
          month: '2026-10',
          released_cost_usd: 0.001843,
        })
      );

      const result = await releaseBudget('00000000-0000-4000-8000-000000000001');

      expect(result.status).toBe('released');
      expect(result.status === 'released' && result.releasedCostUsd).toBe(0.001843);
    });

    it('es idempotente', async () => {
      setSupabaseClient(
        createMockClient({
          status: 'already_processed',
          previous_status: 'released',
        })
      );

      const result = await releaseBudget('00000000-0000-4000-8000-000000000001');

      expect(result.status).toBe('already_processed');
    });
  });

  describe('getBudgetStatus', () => {
    it('devuelve estado mensual', async () => {
      setSupabaseClient(
        createMockClient({
          month: '2026-10',
          total_budget_usd: 5,
          spent_usd: 0.01,
          reserved_usd: 0.02,
          available_usd: 4.97,
          threshold_usd: 4.75,
        })
      );

      const status = await getBudgetStatus('2026-10');

      expect(status.spentUsd).toBe(0.01);
      expect(status.thresholdUsd).toBe(4.75);
    });
  });

  describe('cálculo de costos', () => {
    it('calcula costo máximo de gemini', () => {
      const pricing = requirePricing('gemini-2.5-flash');
      expect(calculateMaxCostUsd(pricing)).toBe(0.001843);
    });

    it('calcula costo actual con tokens reportados', () => {
      const pricing = requirePricing('gpt-4o-mini');
      expect(calculateActualCostUsd({ pricing, tokensInput: 400, tokensOutput: 200, costEstimated: false })).toBe(0.00018);
    });

    it('usa tarifas separadas para input y output', () => {
      const pricing = requirePricing('gpt-4o-mini');
      expect(
        calculateActualCostUsd({
          pricing,
          tokensInput: 600,
          tokensOutput: 200,
          costEstimated: false,
        })
      ).toBe(0.00021);
    });

    it('no reutiliza el precio de gpt-4o-mini para modelos desconocidos', () => {
      expect(getModelPricing('unknown-paid-model')).toBeNull();
    });

    it('usa defaults conservadores si no hay tokens', () => {
      process.env.AI_MAX_TOKENS_DEFAULT_INPUT = '400';
      process.env.AI_MAX_TOKENS_DEFAULT_OUTPUT = '200';
      const pricing = requirePricing('gpt-4o-mini');
      expect(calculateActualCostUsd({ pricing, tokensInput: null, tokensOutput: null, costEstimated: true })).toBe(0.00018);
    });
  });

  describe('cambio de mes UTC', () => {
    it('genera mes UTC', () => {
      const month = getBudgetMonth(new Date('2026-10-15T23:59:59Z'));
      expect(month).toBe('2026-10');
    });
  });
});