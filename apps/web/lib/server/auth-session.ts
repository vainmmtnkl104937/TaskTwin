import 'server-only';

import { cookies } from 'next/headers';
import { getSessionMaxAgeSeconds } from './environment';

export const ACCESS_TOKEN_COOKIE = 'tasktwin_access_token';

export interface AuthCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
  priority: 'high';
  expires?: Date;
}

function cookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getSessionMaxAgeSeconds(),
    priority: 'high',
  };
}

export interface AuthCookieStore {
  set(name: string, value: string, options: AuthCookieOptions): void;
}

export function writeAccessTokenCookie(
  store: AuthCookieStore,
  accessToken: string,
): void {
  store.set(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions());
}

export function clearAccessTokenCookie(store: AuthCookieStore): void {
  store.set(ACCESS_TOKEN_COOKIE, '', {
    ...cookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}
