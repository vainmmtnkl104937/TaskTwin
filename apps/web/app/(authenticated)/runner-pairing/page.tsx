import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, listWorkspaces } from '@/lib/server/control-plane';

import { RunnerPairingForm } from './runner-pairing-form';

export default async function RunnerPairingPage() {
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }
  let workspaces;
  try {
    workspaces = (await listWorkspaces(accessToken)).workspaces;
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    throw error;
  }
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href="/workspaces">Workspaces</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Local execution plane</p>
        <h1>Pair a Local Runner</h1>
        <p>Inspect safe device metadata before assigning one workspace.</p>
      </section>
      <RunnerPairingForm workspaces={workspaces} />
    </main>
  );
}
