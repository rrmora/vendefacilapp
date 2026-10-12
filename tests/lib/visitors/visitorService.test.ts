import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  generateVisitorId,
  isValidVisitorId,
  extractVisitorId,
  getOrCreateVisitorId,
} from '@/lib/visitors/visitorService';

function createRequestWithCookies(cookies: Record<string, string> = {}): NextRequest {
  const headers = new Headers();

  for (const [name, value] of Object.entries(cookies)) {
    headers.append('Cookie', `${name}=${value}`);
  }

  return new NextRequest('http://localhost:3000/api/generate', { headers });
}

function createResponse(): NextResponse {
  return NextResponse.json({ success: true });
}

describe('visitorService', () => {
  describe('generateVisitorId', () => {
    it('genera UUID v4 valido', () => {
      const id = generateVisitorId();

      expect(isValidVisitorId(id)).toBe(true);
    });

    it('genera valores unicos', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateVisitorId()));

      expect(ids.size).toBe(100);
    });
  });

  describe('isValidVisitorId', () => {
    it('acepta UUID v4 valido', () => {
      expect(isValidVisitorId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('rechaza UUID de otra version', () => {
      expect(isValidVisitorId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
    });

    it('rechazar string vacio', () => {
      expect(isValidVisitorId('')).toBe(false);
    });

    it('rechaza string aleatorio', () => {
      expect(isValidVisitorId('not-a-uuid')).toBe(false);
    });
  });

  describe('extractVisitorId', () => {
    it('retorna null cuando no hay cookie', () => {
      const request = createRequestWithCookies();

      expect(extractVisitorId(request)).toBeNull();
    });

    it('retorna visitorId cuando cookie es valida', () => {
      const visitorId = '550e8400-e29b-41d4-a716-446655440000';
      const request = createRequestWithCookies({ visitor_id: visitorId });

      expect(extractVisitorId(request)).toBe(visitorId);
    });

    it('retorna null cuando cookie tiene valor invalido', () => {
      const request = createRequestWithCookies({ visitor_id: 'invalid' });

      expect(extractVisitorId(request)).toBeNull();
    });
  });

  describe('getOrCreateVisitorId', () => {
    it('genera nuevo visitorId cuando no existe cookie', () => {
      const request = createRequestWithCookies();
      const response = createResponse();

      const visitorId = getOrCreateVisitorId(request, response);

      expect(isValidVisitorId(visitorId)).toBe(true);
    });

    it('reutiliza visitorId cuando cookie existe', () => {
      const existingId = '550e8400-e29b-41d4-a716-446655440000';
      const request = createRequestWithCookies({ visitor_id: existingId });
      const response = createResponse();

      const visitorId = getOrCreateVisitorId(request, response);

      expect(visitorId).toBe(existingId);
    });

    it('genera nuevo cuando cookie es invalida', () => {
      const request = createRequestWithCookies({ visitor_id: 'invalid' });
      const response = createResponse();

      const visitorId = getOrCreateVisitorId(request, response);

      expect(isValidVisitorId(visitorId)).toBe(true);
    });

    it('configura cookie con atributos seguros', () => {
      vi.stubEnv('NODE_ENV', 'production');

      const request = createRequestWithCookies();
      const response = createResponse();

      getOrCreateVisitorId(request, response);

      const setCookieHeader = response.headers.get('set-cookie');

      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('SameSite=lax');
      expect(setCookieHeader).toContain('Secure');
      expect(setCookieHeader).toContain('Path=/');
      expect(setCookieHeader).toContain('Max-Age=31536000');

      vi.unstubAllEnvs();
    });

    it('omite Secure en desarrollo', () => {
      vi.stubEnv('NODE_ENV', 'development');

      const request = createRequestWithCookies();
      const response = createResponse();

      getOrCreateVisitorId(request, response);

      const setCookieHeader = response.headers.get('set-cookie');

      expect(setCookieHeader).not.toContain('Secure');

      vi.unstubAllEnvs();
    });
  });
});
