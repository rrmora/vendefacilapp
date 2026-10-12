import { randomUUID } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

const VISITOR_COOKIE_NAME = 'visitor_id';
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateVisitorId(): string {
  return randomUUID();
}

export function isValidVisitorId(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function extractVisitorId(request: NextRequest): string | null {
  const cookie = request.cookies.get(VISITOR_COOKIE_NAME);

  if (!cookie || !cookie.value) {
    return null;
  }

  return isValidVisitorId(cookie.value) ? cookie.value : null;
}

export function getOrCreateVisitorId(
  request: NextRequest,
  response: NextResponse
): string {
  const existing = extractVisitorId(request);

  if (existing) {
    return existing;
  }

  const visitorId = generateVisitorId();

  response.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VISITOR_COOKIE_MAX_AGE,
  });

  return visitorId;
}
