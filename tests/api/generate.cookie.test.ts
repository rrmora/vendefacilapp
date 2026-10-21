import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '../../src/app/api/generate/route';
import {
  authorizeRealCalls,
  revokeRealCallsAuthorization,
} from '../../src/lib/ai/descriptionService';
import { resetAIConfigCache } from '../../src/lib/ai/config';
import {
  resetSupabaseClient,
  setSupabaseClient,
} from '../../src/lib/db/supabaseClient';
import { isValidVisitorId } from '../../src/lib/visitors/visitorService';

const VALID_VISITOR_ID = '550e8400-e29b-41d4-a716-446655440000';

const validBody = {
  category: 'electronica' as const,
  condition: 'buen_estado' as const,
  pricingType: 'fijo' as const,
  userNotes: 'iPhone 13 de 128 GB, batería al 85%, incluye cargador',
};

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_GEMINI_API_KEY',
  'TRUST_PROXY',
  'AI_GEMINI_MODEL',
  'AI_GEMINI_TIMEOUT_MS',
  'AI_GLOBAL_TIMEOUT_MS',
] as const;

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-real-ip': '192.0.2.10',
      ...headers,
    },
    body: JSON.stringify(validBody),
  });
}

function createMockClient(): {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'check_rate_limit') {
      return {
        data: {
          status: 'allowed',
          counts: { minute: 1, hour: 1, day: 1 },
          limits: { minute: 10, hour: 100, day: 500 },
        },
        error: null,
      };
    }

    if (name === 'reserve_quota') {
      return {
        data: { status: 'reserved', generations_used: 1, max_generations: 5 },
        error: null,
      };
    }

    if (name === 'mark_quota_sent') {
      return { data: { status: 'sent' }, error: null };
    }

    if (name === 'confirm_quota') {
      return { data: { status: 'confirmed' }, error: null };
    }

    if (name === 'release_quota') {
      return { data: { status: 'released' }, error: null };
    }

    if (name === 'reserve_budget') {
      return {
        data: {
          status: 'reserved',
          reservation_id: 'budget-1',
          month: '2026-10',
          reserved_cost_usd: 0.001843,
          spent_usd: 0,
          reserved_usd: 0.001843,
          total_budget_usd: 5,
        },
        error: null,
      };
    }

    if (name === 'confirm_budget') {
      return { data: { status: 'confirmed' }, error: null };
    }

    if (name === 'release_budget') {
      return { data: { status: 'released' }, error: null };
    }

    return { data: { status: 'ok' }, error: null };
  });

  const from = vi.fn(() => ({
    insert: vi.fn(async () => ({ data: null, error: null })),
  }));

  return {
    client: { rpc, from } as unknown as SupabaseClient,
    rpc,
  };
}

function reservedVisitorIds(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpc.mock.calls
    .filter(([name]) => name === 'reserve_quota')
    .map(
      ([, params]) =>
        (params as { p_visitor_id: string }).p_visitor_id
    );
}

function visitorIdFromSetCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');

  expect(setCookie).toBeTruthy();

  const match = /visitor_id=([^;]+)/.exec(setCookie ?? '');

  expect(match).toBeTruthy();

  return decodeURIComponent(match?.[1] ?? '');
}

describe('POST /api/generate visitor cookie handling', () => {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Descripción generada' }] } }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );

  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    fetchMock.mockClear();

    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }

    process.env.AI_ENABLED = 'true';
    process.env.AI_GEMINI_API_KEY = 'test-key';
    process.env.TRUST_PROXY = 'true';

    revokeRealCallsAuthorization();
    resetAIConfigCache();
    resetSupabaseClient();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    revokeRealCallsAuthorization();
    resetAIConfigCache();
    resetSupabaseClient();
    vi.unstubAllGlobals();
  });

  it.each([
    ['primera cookie', `visitor_id=${VALID_VISITOR_ID}`],
    ['después de otra cookie sin espacio', `otra=1;visitor_id=${VALID_VISITOR_ID}`],
    ['después de otra cookie con espacio', `otra=1; visitor_id=${VALID_VISITOR_ID}`],
    ['después de varias cookies', `a=1; b=2; visitor_id=${VALID_VISITOR_ID}`],
  ])('reconoce visitor_id como %s', async (_name, cookie) => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest({ cookie }));

    expect(response.status).toBe(200);
    expect(reservedVisitorIds(rpc)).toEqual([VALID_VISITOR_ID]);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('crea un visitante válido cuando la cookie está ausente', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest());
    const newVisitorId = visitorIdFromSetCookie(response);

    expect(response.status).toBe(200);
    expect(isValidVisitorId(newVisitorId)).toBe(true);
    expect(reservedVisitorIds(rpc)).toEqual([newVisitorId]);
  });

  it('descarta un UUID inválido y genera uno nuevo', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest({ cookie: 'visitor_id=no-es-uuid' }));
    const newVisitorId = visitorIdFromSetCookie(response);

    expect(response.status).toBe(200);
    expect(isValidVisitorId(newVisitorId)).toBe(true);
    expect(newVisitorId).not.toBe('no-es-uuid');
    expect(reservedVisitorIds(rpc)).toEqual([newVisitorId]);
  });

  it('no devuelve 500 con una codificación malformada', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const response = await POST(buildRequest({ cookie: 'visitor_id=%E0%A4%A' }));
    const newVisitorId = visitorIdFromSetCookie(response);

    expect(response.status).toBe(200);
    expect(isValidVisitorId(newVisitorId)).toBe(true);
    expect(reservedVisitorIds(rpc)).toEqual([newVisitorId]);
  });

  it('conserva el visitante y su cuota en dos solicitudes consecutivas', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const cookie = `otra=1; visitor_id=${VALID_VISITOR_ID}`;
    const first = await POST(buildRequest({ cookie }));
    const second = await POST(buildRequest({ cookie }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(reservedVisitorIds(rpc)).toEqual([
      VALID_VISITOR_ID,
      VALID_VISITOR_ID,
    ]);
    expect(first.headers.get('set-cookie')).toBeNull();
    expect(second.headers.get('set-cookie')).toBeNull();
  });

  it('reutiliza en la segunda solicitud el visitante creado en la primera', async () => {
    const { client, rpc } = createMockClient();
    setSupabaseClient(client);
    authorizeRealCalls();

    const first = await POST(buildRequest());
    const newVisitorId = visitorIdFromSetCookie(first);
    const second = await POST(
      buildRequest({ cookie: `otra=1; visitor_id=${newVisitorId}` })
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('set-cookie')).toBeNull();
    expect(reservedVisitorIds(rpc)).toEqual([newVisitorId, newVisitorId]);
  });
});
