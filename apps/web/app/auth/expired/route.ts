import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { clearAccessTokenCookie } from '@/lib/server/auth-session';

export async function GET(request: Request): Promise<NextResponse> {
  clearAccessTokenCookie(await cookies());
  return NextResponse.redirect(new URL('/login?expired=1', request.url), 303);
}
