export interface IDescriptionRequest {
  category:
    | 'ropa'
    | 'electronica'
    | 'hogar'
    | 'vehiculos'
    | 'otros';

  condition:
    | 'nuevo'
    | 'como_nuevo'
    | 'buen_estado'
    | 'detalles_uso';

  pricingType: 'fijo' | 'negociable';

  userNotes: string;
}

export type DescriptionErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'INTERNAL_ERROR';

export type IDescriptionResponse =
  | {
      success: true;
      generatedText: string;
      tokensUsed: number | null;
    }
  | {
      success: false;
      generatedText: '';
      tokensUsed: null;
      errorCode: DescriptionErrorCode;
      errorMessage: string;
    };
