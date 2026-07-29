import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { clearAccessTokenCookie } from '@/lib/server/auth-session';

export async function POST(request: Request): Promise<NextResponse> {
  clearAccessTokenCookie(await cookies());
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
