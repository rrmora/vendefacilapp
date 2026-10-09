import type {
  IDescriptionRequest,
  IDescriptionResponse,
} from '@/types/description';

const GENERATE_DESCRIPTION_ENDPOINT = '/api/generate';

const NETWORK_ERROR_MESSAGE =
  'No pudimos generar la descripción. Revisa tu conexión e inténtalo de nuevo.';

export async function generateDescription(
  request: IDescriptionRequest
): Promise<IDescriptionResponse> {
  try {
    const response = await fetch(GENERATE_DESCRIPTION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    return (await response.json()) as IDescriptionResponse;
  } catch {
    return {
      success: false,
      generatedText: '',
      tokensUsed: null,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: NETWORK_ERROR_MESSAGE,
    };
  }
}
