import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';

import { LoginForm } from './login-form';

interface LoginPageProps {
  searchParams: Promise<{ expired?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if ((await getAccessToken()) !== null) {
    redirect('/workspaces');
  }

  const params = await searchParams;
  const expiredFlag = Array.isArray(params.expired)
    ? params.expired[0]
    : params.expired;
  const showExpiredBanner = expiredFlag === '1';

  return (
    <main className="auth-page">
      <section className="panel auth-card" aria-labelledby="login-heading">
        <p className="eyebrow">TaskTwin Control Plane</p>
        <h1 id="login-heading">Sign in</h1>
        <p>Open and safely edit your draft browser workflows.</p>
        {showExpiredBanner ? (
          <p className="info-banner" role="status">
            Your previous session expired. Please sign in again.
          </p>
        ) : null}
        <LoginForm />
      </section>
    </main>
  );
}
