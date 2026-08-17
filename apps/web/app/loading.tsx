import { LoadingSkeletonList } from '@/components/loading-skeleton';

export default function Loading() {
  return (
    <main className="dashboard-page" aria-busy="true">
      <section className="page-heading">
        <p className="eyebrow">TaskTwin Control Plane</p>
        <h1>Loading…</h1>
        <p className="metadata">Fetching the latest state from the Control Plane.</p>
      </section>
      <LoadingSkeletonList count={6} variant="panel" label="Loading content" />
    </main>
  );
}