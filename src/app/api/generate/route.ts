import { NextResponse } from 'next/server';
import type { ZodIssue } from 'zod';
import { descriptionRequestSchema } from '@/features/description/schemas/description.schema';
import { generateDescription } from '@/lib/ai/descriptionService';
import type { IDescriptionResponse } from '@/types/description';

function validationErrorResponse(issues: ZodIssue[]): IDescriptionResponse {
  const fields = issues
    .map((issue) => issue.path.join('.'))
    .filter((path) => path.length > 0);

  return {
    success: false,
    generatedText: '',
    tokensUsed: null,
    errorCode: 'VALIDATION_ERROR',
    errorMessage:
      fields.length > 0
        ? `Revisa los siguientes campos: ${fields.join(', ')}.`
        : 'Revisa los datos del formulario e inténtalo de nuevo.',
  };
}

function internalErrorResponse(message: string): IDescriptionResponse {
  return {
    success: false,
    generatedText: '',
    tokensUsed: null,
    errorCode: 'INTERNAL_ERROR',
    errorMessage: message,
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = descriptionRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(validationErrorResponse(parsed.error.issues), {
      status: 400,
    });
  }

  const { generateVisitorId, extractVisitorIdFromCookieHeader } = await import(
    '@/lib/visitors/visitorService'
  );
  const { extractClientIp } = await import('@/lib/ratelimit/rateLimiter');

  const existingVisitorId = extractVisitorIdFromCookieHeader(
    request.headers.get('cookie')
  );
  const visitorId = existingVisitorId ?? generateVisitorId();
  const shouldSetVisitorCookie = !existingVisitorId;
  const clientIp = extractClientIp(request);

  const result = await generateDescription(parsed.data, {
    signal: request.signal,
    visitorId,
    clientIp,
  });

  const response = NextResponse.json(result.response, {
    status: result.status,
  });

  if (shouldSetVisitorCookie) {
    response.cookies.set('visitor_id', visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export async function GET(): Promise<Response> {
  return NextResponse.json(internalErrorResponse('Método no permitido.'), {
    status: 405,
  });
}
