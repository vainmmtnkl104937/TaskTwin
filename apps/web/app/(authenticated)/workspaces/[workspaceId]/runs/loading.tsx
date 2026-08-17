import { LoadingSkeletonList } from '@/components/loading-skeleton';

export default function Loading() {
  return (
    <main className="dashboard-page" aria-busy="true">
      <section className="page-heading">
        <p className="eyebrow">Local execution</p>
        <h1>Workflow runs</h1>
        <p className="metadata">Loading the latest run history…</p>
      </section>
      <LoadingSkeletonList
        count={5}
        variant="row"
        label="Loading workflow runs"
      />
    </main>
  );
}