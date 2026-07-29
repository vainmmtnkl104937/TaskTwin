'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { writeAccessTokenCookie } from '@/lib/server/auth-session';
import { ControlPlaneError, login } from '@/lib/server/control-plane';

const LoginInputSchema = z.strictObject({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export interface LoginActionState {
  status: 'idle' | 'error';
  message?: string;
}

export async function loginAction(
  _previous: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const input = LoginInputSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!input.success) {
    return {
      status: 'error',
      message: 'Enter a valid email and password.',
    };
  }

  try {
    const response = await login(input.data.email, input.data.password);
    writeAccessTokenCookie(await cookies(), response.accessToken);
  } catch (error: unknown) {
    return {
      status: 'error',
      message:
        error instanceof ControlPlaneError && error.status === 401
          ? 'Invalid email or password.'
          : 'Sign in is temporarily unavailable.',
    };
  }

  redirect('/workspaces');
}
