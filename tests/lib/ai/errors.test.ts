import { describe, expect, it } from 'vitest';
import {
  AIProviderError,
  isRecoverableKind,
  toPublicErrorCode,
} from '@/lib/ai/errors';
import type { AIProviderErrorKind } from '@/lib/ai/errors';

describe('AIProviderError', () => {
  it('clasifica como recuperables los errores con fallback permitido', () => {
    const kinds: AIProviderErrorKind[] = [
      'RATE_LIMITED',
      'PROVIDER_ERROR',
      'AUTH_ERROR',
      'NOT_CONFIGURED',
    ];

    for (const kind of kinds) {
      const error = new AIProviderError({
        kind,
        provider: 'groq',
        message: 'detalle interno',
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AIProviderError');
      expect(error.kind).toBe(kind);
      expect(error.provider).toBe('groq');
      expect(error.recoverable).toBe(true);
      expect(isRecoverableKind(kind)).toBe(true);
    }
  });

  it('clasifica como no recuperables seguridad, presupuesto y solicitud inválida', () => {
    const kinds: AIProviderErrorKind[] = [
      'SECURITY_BLOCK',
      'BUDGET_EXCEEDED',
      'INVALID_REQUEST',
    ];

    for (const kind of kinds) {
      const error = new AIProviderError({
        kind,
        provider: 'openai',
        message: 'detalle interno',
      });

      expect(error.recoverable).toBe(false);
      expect(isRecoverableKind(kind)).toBe(false);
    }
  });

  it('trata el envío como desconocido por defecto y permite declararlo pre-envío', () => {
    const unknown = new AIProviderError({
      kind: 'PROVIDER_ERROR',
      provider: 'gemini',
      message: 'detalle interno',
    });
    const preSend = new AIProviderError({
      kind: 'PROVIDER_ERROR',
      provider: 'gemini',
      message: 'detalle interno',
      requestDispatched: false,
    });

    expect(unknown.requestDispatched).toBe(true);
    expect(preSend.requestDispatched).toBe(false);
  });
});

describe('toPublicErrorCode', () => {
  it('preserva BUDGET_EXCEEDED para la implementación de T-004', () => {
    expect(toPublicErrorCode('BUDGET_EXCEEDED')).toBe('BUDGET_EXCEEDED');
  });

  it('mapea bloqueos de seguridad y solicitudes inválidas a INTERNAL_ERROR', () => {
    expect(toPublicErrorCode('SECURITY_BLOCK')).toBe('INTERNAL_ERROR');
    expect(toPublicErrorCode('INVALID_REQUEST')).toBe('INTERNAL_ERROR');
  });

  it('mapea por defecto a PROVIDER_UNAVAILABLE', () => {
    expect(toPublicErrorCode('RATE_LIMITED')).toBe('PROVIDER_UNAVAILABLE');
    expect(toPublicErrorCode('AUTH_ERROR')).toBe('PROVIDER_UNAVAILABLE');
    expect(toPublicErrorCode('NOT_CONFIGURED')).toBe('PROVIDER_UNAVAILABLE');
  });
});
