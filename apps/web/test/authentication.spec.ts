import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  login: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/lib/server/control-plane', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/server/control-plane')>();
  return {
    ...original,
    login: mocks.login,
  };
});

import { loginAction } from '@/app/login/actions';
import {
  ACCESS_TOKEN_COOKIE,
  clearAccessTokenCookie,
} from '@/lib/server/auth-session';
import { ControlPlaneError } from '@/lib/server/control-plane';

function loginFormData(): FormData {
  const form = new FormData();
  form.set('email', 'owner@example.test');
  form.set('password', 'correct-password');
  return form;
}

describe('web authentication bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets a secure HTTP-only cookie without returning the token to client code', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.login.mockResolvedValue({
      user: {
        id: '8f132a7b-b42b-46d9-9848-29f26385096a',
        email: 'owner@example.test',
        displayName: 'Owner',
        isActive: true,
        createdAt: '2026-07-29T20:00:00.000Z',
        updatedAt: '2026-07-29T20:00:00.000Z',
      },
      accessToken: 'server-only-access-token',
    });

    const result = await loginAction({ status: 'idle' }, loginFormData());

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      'server-only-access-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 900,
        priority: 'high',
      }),
    );
    expect(result).toBeUndefined();
    expect(mocks.redirect).toHaveBeenCalledWith('/workspaces');
  });

  it('does not set a cookie after invalid credentials', async () => {
    mocks.login.mockRejectedValue(
      new ControlPlaneError(401, { message: 'generic' }),
    );

    await expect(
      loginAction({ status: 'idle' }, loginFormData()),
    ).resolves.toEqual({
      status: 'error',
      message: 'Invalid email or password.',
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('clears the local cookie without exposing its value', () => {
    clearAccessTokenCookie({
      set: mocks.cookieSet,
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      '',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 0,
        expires: new Date(0),
      }),
    );
  });
});
