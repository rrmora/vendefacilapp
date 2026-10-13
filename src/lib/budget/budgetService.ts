import { randomUUID } from 'crypto';
import { callRpc } from '@/lib/db/supabaseClient';

export interface ModelPricing {
  model: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gemini-2.5-flash': {
    model: 'gemini-2.5-flash',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
    maxInputTokens: 8192,
    maxOutputTokens: 1024,
  },
  'llama-3.3-70b-versatile': {
    model: 'llama-3.3-70b-versatile',
    inputUsdPer1M: 0.59,
    outputUsdPer1M: 0.79,
    maxInputTokens: 8192,
    maxOutputTokens: 1024,
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.6,
    maxInputTokens: 8192,
    maxOutputTokens: 1024,
  },
};

const FALLBACK_PRICING: ModelPricing = MODEL_PRICING['gpt-4o-mini'];

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

export function calculateMaxCostUsd(pricing: ModelPricing): number {
  return roundCost(
    (pricing.maxInputTokens * pricing.inputUsdPer1M +
      pricing.maxOutputTokens * pricing.outputUsdPer1M) /
      1_000_000
  );
}

export function calculateActualCostUsd(options: {
  pricing: ModelPricing;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  costEstimated?: boolean;
}): number {
  const defaultInput = parseNumber(process.env.AI_MAX_TOKENS_DEFAULT_INPUT, 400);
  const defaultOutput = parseNumber(process.env.AI_MAX_TOKENS_DEFAULT_OUTPUT, 200);
  const tokensInput =
    options.tokensInput === null || options.tokensInput === undefined
      ? options.costEstimated
        ? defaultInput
        : 0
      : Math.max(0, options.tokensInput);
  const tokensOutput =
    options.tokensOutput === null || options.tokensOutput === undefined
      ? options.costEstimated
        ? defaultOutput
        : 0
      : Math.max(0, options.tokensOutput);

  return roundCost(
    (tokensInput * options.pricing.inputUsdPer1M +
      tokensOutput * options.pricing.outputUsdPer1M) /
      1_000_000
  );
}

export function getMonthlyBudgetUsd(): number {
  return parseNumber(process.env.AI_MONTHLY_BUDGET_USD, 5);
}

export function getBudgetMonth(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export class BudgetServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetServiceError';
  }
}

export type BudgetReservationResult =
  | {
      status: 'reserved';
      reservationId: string;
      month: string;
      reservedCostUsd: number;
      spentUsd: number;
      reservedUsd: number;
      totalBudgetUsd: number;
    }
  | {
      status: 'already_reserved';
      reservationId: string;
      month: string;
      reservedCostUsd: number;
      spentUsd: number;
      reservedUsd: number;
      totalBudgetUsd: number;
    }
  | {
      status: 'budget_exceeded';
      month: string;
      spentUsd: number;
      reservedUsd: number;
      totalBudgetUsd: number;
      availableUsd: number;
    }
  | { status: 'invalid_cost' };

export type BudgetConfirmationResult =
  | {
      status: 'confirmed';
      month: string;
      reservedCostUsd: number;
      actualCostUsd: number;
      costEstimated: boolean;
    }
  | { status: 'already_processed'; previousStatus: string }
  | { status: 'not_found' };

export type BudgetReleaseResult =
  | { status: 'released'; month: string; releasedCostUsd: number }
  | { status: 'already_processed'; previousStatus: string }
  | { status: 'not_found' };

export interface BudgetStatus {
  month: string;
  totalBudgetUsd: number;
  spentUsd: number;
  reservedUsd: number;
  availableUsd: number;
  thresholdUsd: number;
}

export interface ReserveBudgetRequest {
  reservationId?: string;
  month?: string;
  maxCostUsd: number;
  totalBudgetUsd?: number;
}

export async function reserveBudget(
  request: ReserveBudgetRequest
): Promise<BudgetReservationResult> {
  const month = request.month ?? getBudgetMonth();
  const totalBudgetUsd = request.totalBudgetUsd ?? getMonthlyBudgetUsd();
  const reservationId = request.reservationId ?? randomUUID();
  validateMonth(month);

  if (
    !Number.isFinite(request.maxCostUsd) ||
    request.maxCostUsd < 0
  ) {
    return { status: 'invalid_cost' };
  }

  try {
    const result = await callRpc<{
      status: string;
      reservation_id?: string;
      month?: string;
      reserved_cost_usd?: number;
      spent_usd?: number;
      reserved_usd?: number;
      total_budget_usd?: number;
      available_usd?: number;
    }>('reserve_budget', {
      p_reservation_id: reservationId,
      p_month: month,
      p_max_cost_usd: request.maxCostUsd,
      p_total_budget_usd: totalBudgetUsd,
    });

    if (result.status === 'reserved' || result.status === 'already_reserved') {
      return {
        status: result.status,
        reservationId,
        month: result.month ?? month,
        reservedCostUsd: result.reserved_cost_usd ?? request.maxCostUsd,
        spentUsd: result.spent_usd ?? 0,
        reservedUsd: result.reserved_usd ?? 0,
        totalBudgetUsd: result.total_budget_usd ?? totalBudgetUsd,
      };
    }

    if (result.status === 'budget_exceeded') {
      return {
        status: 'budget_exceeded',
        month: result.month ?? month,
        spentUsd: result.spent_usd ?? 0,
        reservedUsd: result.reserved_usd ?? 0,
        totalBudgetUsd: result.total_budget_usd ?? totalBudgetUsd,
        availableUsd: result.available_usd ?? 0,
      };
    }

    if (result.status === 'invalid_cost') {
      return { status: 'invalid_cost' };
    }

    throw new BudgetServiceError(`Respuesta inesperada de reserve_budget: ${result.status}`);
  } catch (error) {
    if (error instanceof BudgetServiceError) {
      throw error;
    }
    throw new BudgetServiceError(
      `No se pudo reservar presupuesto: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function confirmBudget(request: {
  reservationId: string;
  actualCostUsd: number;
  costEstimated?: boolean;
}): Promise<BudgetConfirmationResult> {
  const actualCostUsd = Number.isFinite(request.actualCostUsd)
    ? Math.max(0, request.actualCostUsd)
    : 0;

  try {
    const result = await callRpc<{
      status: string;
      month?: string;
      reserved_cost_usd?: number;
      actual_cost_usd?: number;
      cost_estimated?: boolean;
      previous_status?: string;
    }>('confirm_budget', {
      p_reservation_id: request.reservationId,
      p_actual_cost_usd: actualCostUsd,
      p_cost_estimated: Boolean(request.costEstimated),
    });

    if (result.status === 'confirmed') {
      return {
        status: 'confirmed',
        month: result.month ?? getBudgetMonth(),
        reservedCostUsd: result.reserved_cost_usd ?? 0,
        actualCostUsd: result.actual_cost_usd ?? actualCostUsd,
        costEstimated: Boolean(result.cost_estimated),
      };
    }

    if (result.status === 'already_processed') {
      return {
        status: 'already_processed',
        previousStatus: result.previous_status ?? 'unknown',
      };
    }

    if (result.status === 'not_found') {
      return { status: 'not_found' };
    }

    throw new BudgetServiceError(`Respuesta inesperada de confirm_budget: ${result.status}`);
  } catch (error) {
    if (error instanceof BudgetServiceError) {
      throw error;
    }
    throw new BudgetServiceError(
      `No se pudo confirmar presupuesto: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function releaseBudget(reservationId: string): Promise<BudgetReleaseResult> {
  try {
    const result = await callRpc<{
      status: string;
      month?: string;
      released_cost_usd?: number;
      previous_status?: string;
    }>('release_budget', {
      p_reservation_id: reservationId,
    });

    if (result.status === 'released') {
      return {
        status: 'released',
        month: result.month ?? getBudgetMonth(),
        releasedCostUsd: result.released_cost_usd ?? 0,
      };
    }

    if (result.status === 'already_processed') {
      return {
        status: 'already_processed',
        previousStatus: result.previous_status ?? 'unknown',
      };
    }

    if (result.status === 'not_found') {
      return { status: 'not_found' };
    }

    throw new BudgetServiceError(`Respuesta inesperada de release_budget: ${result.status}`);
  } catch (error) {
    if (error instanceof BudgetServiceError) {
      throw error;
    }
    throw new BudgetServiceError(
      `No se pudo liberar presupuesto: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function getBudgetStatus(
  month?: string,
  totalBudgetUsd?: number
): Promise<BudgetStatus> {
  const resolvedMonth = month ?? getBudgetMonth();
  const resolvedTotal = totalBudgetUsd ?? getMonthlyBudgetUsd();
  validateMonth(resolvedMonth);

  try {
    const result = await callRpc<{
      month: string;
      total_budget_usd: number;
      spent_usd: number;
      reserved_usd: number;
      available_usd: number;
      threshold_usd: number;
    }>('get_budget_status', {
      p_month: resolvedMonth,
      p_total_budget_usd: resolvedTotal,
    });

    return {
      month: result.month,
      totalBudgetUsd: result.total_budget_usd,
      spentUsd: result.spent_usd,
      reservedUsd: result.reserved_usd,
      availableUsd: result.available_usd,
      thresholdUsd: result.threshold_usd,
    };
  } catch (error) {
    throw new BudgetServiceError(
      `No se pudo consultar presupuesto: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export {
  setSupabaseClient,
  resetSupabaseClient,
} from '@/lib/db/supabaseClient';

function validateMonth(month: string): void {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BudgetServiceError(`Mes inválido: ${month}`);
  }
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
}