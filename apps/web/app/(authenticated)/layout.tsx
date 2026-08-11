import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getAccessToken } from '@/lib/server/auth-session';
import { NotificationBell } from '@/components/notification-bell';

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
        <div className="header-actions">
          <Link href="/runner-releases">Runner releases</Link>
          <NotificationBell />
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="secondary-button">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
