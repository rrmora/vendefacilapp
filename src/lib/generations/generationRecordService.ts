import { getSupabaseClient } from '@/lib/db/supabaseClient';

export interface RecordGenerationRequest {
  visitorId: string;
  quotaReservationId?: string | null;
  success: boolean;
  provider?: string | null;
  model?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  estimatedCostUsd: number;
  costEstimated: boolean;
  errorCode?: string | null;
}

export class GenerationRecordServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationRecordServiceError';
  }
}

export async function recordGeneration(request: RecordGenerationRequest): Promise<void> {
  try {
    const client = getSupabaseClient();

    const { error } = await client.from('generation_records').insert({
      visitor_id: request.visitorId,
      reservation_id: request.quotaReservationId ?? null,
      success: request.success,
      provider: request.provider ?? null,
      model: request.model ?? null,
      tokens_input: request.tokensInput ?? null,
      tokens_output: request.tokensOutput ?? null,
      estimated_cost_usd: request.estimatedCostUsd,
      cost_estimated: request.costEstimated,
      error_code: request.errorCode ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    throw new GenerationRecordServiceError(
      `No se pudo registrar consumo: ${error instanceof Error ? error.message : 'error desconocido'}`
    );
  }
}
