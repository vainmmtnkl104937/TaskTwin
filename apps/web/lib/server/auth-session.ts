import 'server-only';

import { cookies } from 'next/headers';

export const ACCESS_TOKEN_COOKIE = 'tasktwin_access_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export interface AuthCookieStore {
  set(name: string, value: string, options: typeof COOKIE_OPTIONS): void;
  delete(name: string): void;
}

export function writeAccessTokenCookie(
  store: AuthCookieStore,
  accessToken: string,
): void {
  store.set(ACCESS_TOKEN_COOKIE, accessToken, COOKIE_OPTIONS);
}

export function clearAccessTokenCookie(store: AuthCookieStore): void {
  store.delete(ACCESS_TOKEN_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}
