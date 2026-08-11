import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { listRunnerReleases } from '@/lib/server/control-plane';

export default async function RunnerReleasesPage() {
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const releases = await listRunnerReleases(token);
  return (
    <main className="dashboard-page">
      <Link href="/workspaces">Workspaces</Link>
      <section className="page-heading">
        <p className="eyebrow">Release governance</p>
        <h1>Trusted Runner Releases</h1>
        <p>
          Every entry is imported from a verified Session 31 signed manifest.
          Catalog metadata never contains an updater command or artifact body.
        </p>
      </section>
      <section className="workflow-list" aria-label="Trusted Runner releases">
        {releases.map((release) => (
          <article className="panel workflow-list-item" key={release.id}>
            <h2>{release.version}</h2>
            <p>
              {release.product} · {release.status}
            </p>
            <p className="metadata">
              Manifest digest: {release.manifestDigest} · Signing key:{' '}
              {release.signingKeyId}
            </p>
            <p>
              Targets:{' '}
              {release.manifest.artifacts
                .map(
                  (artifact) => `${artifact.platform}/${artifact.architecture}`,
                )
                .join(', ')}
            </p>
          </article>
        ))}
        {releases.length === 0 ? (
          <p className="empty-state">No trusted release has been imported.</p>
        ) : null}
      </section>
    </main>
  );
}
