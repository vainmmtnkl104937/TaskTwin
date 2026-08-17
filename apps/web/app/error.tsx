'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const message = error.message.length > 0 ? error.message : 'Unknown';
      const safeDigest = error.digest ?? 'none';
      console.error('Render error', { message, digest: safeDigest });
    }
  }, [error]);

  return (
    <main className="dashboard-page">
      <section className="panel error-state" aria-labelledby="error-heading">
        <p className="eyebrow">TaskTwin Control Plane</p>
        <h1 id="error-heading">Something went wrong</h1>
        <p>
          The page could not be loaded. No secret values, recorded browser
          events, or hidden states are shown here; the issue is reported with
          a stable internal code so the team can investigate.
        </p>
        <p className="metadata">
          Internal code: <code>{error.digest ?? 'unhashed_render_error'}</code>
        </p>
        <div className="button-group">
          <button type="button" onClick={reset}>
            Try again
          </button>
          <Link className="button-link" href="/workspaces">
            Back to workspaces
          </Link>
        </div>
        <p className="metadata">
          If this keeps repeating, copy the internal code above and include it
          when you file an issue. Avoid pasting any value the Runner prompted
          you for, recorded URLs, or any text you typed on a recorded page.
        </p>
      </section>
    </main>
  );
}