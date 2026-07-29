import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getAccessToken } from '@/lib/server/auth-session';

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  if ((await getAccessToken()) === null) {
    redirect('/login');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/workspaces" className="brand">
          TaskTwin
        </Link>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="secondary-button">
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
