import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  if ((await getAccessToken()) !== null) {
    redirect('/workspaces');
  }

  return (
    <main className="auth-page">
      <section className="panel auth-card" aria-labelledby="login-heading">
        <p className="eyebrow">TaskTwin Control Plane</p>
        <h1 id="login-heading">Sign in</h1>
        <p>Open and safely edit your draft browser workflows.</p>
        <LoginForm />
      </section>
    </main>
  );
}
