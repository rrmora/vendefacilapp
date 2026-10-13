import { randomUUID } from 'crypto';
import { callRpc } from '@/lib/db/supabaseClient';

export type QuotaReservationResult =
  | { status: 'reserved'; reservationId: string; generationsUsed: number; maxGenerations: number }
  | { status: 'quota_exceeded'; generationsUsed: number; maxGenerations: number }
  | { status: 'rate_limited'; pendingCount: number };

export type QuotaConfirmationResult =
  | { status: 'confirmed' }
  | { status: 'already_processed'; previousStatus: string }
  | { status: 'not_found' };

export type QuotaReleaseResult =
  | { status: 'released' }
  | { status: 'already_processed'; previousStatus: string }
  | { status: 'not_found' };

export interface QuotaStatus {
  visitorId: string;
  quotaDate: string;
  generationsUsed: number;
  maxGenerations: number;
  pendingReservations: number;
  remaining: number;
}

export class QuotaServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaServiceError';
  }
}

function getQuotaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

export async function reserveQuota(visitorId: string): Promise<QuotaReservationResult> {
  const quotaDate = getQuotaDate();
  const reservationId = randomUUID();

  try {
    const result = await callRpc<{
      status: string;
      generations_used?: number;
      max_generations?: number;
      pending_count?: number;
    }>('reserve_quota', {
      p_visitor_id: visitorId,
      p_quota_date: quotaDate,
      p_reservation_id: reservationId,
    });

    if (result.status === 'reserved') {
      return {
        status: 'reserved',
        reservationId,
        generationsUsed: result.generations_used!,
        maxGenerations: result.max_generations!,
      };
    }

    if (result.status === 'quota_exceeded') {
      return {
        status: 'quota_exceeded',
        generationsUsed: result.generations_used!,
        maxGenerations: result.max_generations!,
      };
    }

    return {
      status: 'rate_limited',
      pendingCount: result.pending_count!,
    };
  } catch (error) {
    throw new QuotaServiceError(
      `No se pudo reservar cuota: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function confirmQuota(reservationId: string): Promise<QuotaConfirmationResult> {
  try {
    const result = await callRpc<{
      status: string;
      previous_status?: string;
    }>('confirm_quota', {
      p_reservation_id: reservationId,
    });

    if (result.status === 'confirmed') {
      return { status: 'confirmed' };
    }

    if (result.status === 'already_processed') {
      return { status: 'already_processed', previousStatus: result.previous_status! };
    }

    return { status: 'not_found' };
  } catch (error) {
    throw new QuotaServiceError(
      `No se pudo confirmar cuota: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function releaseQuota(reservationId: string): Promise<QuotaReleaseResult> {
  try {
    const result = await callRpc<{
      status: string;
      previous_status?: string;
    }>('release_quota', {
      p_reservation_id: reservationId,
    });

    if (result.status === 'released') {
      return { status: 'released' };
    }

    if (result.status === 'already_processed') {
      return { status: 'already_processed', previousStatus: result.previous_status! };
    }

    return { status: 'not_found' };
  } catch (error) {
    throw new QuotaServiceError(
      `No se pudo liberar cuota: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}

export async function getQuotaStatus(visitorId: string, quotaDate?: string): Promise<QuotaStatus> {
  const date = quotaDate ?? getQuotaDate();

  try {
    const result = await callRpc<{
      visitor_id: string;
      quota_date: string;
      generations_used: number;
      max_generations: number;
      pending_reservations: number;
      remaining: number;
    }>('get_quota_status', {
      p_visitor_id: visitorId,
      p_quota_date: date,
    });

    return {
      visitorId: result.visitor_id,
      quotaDate: result.quota_date,
      generationsUsed: result.generations_used,
      maxGenerations: result.max_generations,
      pendingReservations: result.pending_reservations,
      remaining: result.remaining,
    };
  } catch (error) {
    throw new QuotaServiceError(
      `No se pudo consultar cuota: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}
