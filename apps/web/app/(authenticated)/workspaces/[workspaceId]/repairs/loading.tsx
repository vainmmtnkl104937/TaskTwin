import { LoadingSkeletonList } from '@/components/loading-skeleton';

export default function Loading() {
  return (
    <main className="dashboard-page" aria-busy="true">
      <section className="page-heading">
        <p className="eyebrow">Recovery</p>
        <h1>Repair center</h1>
        <p className="metadata">Loading repair requests…</p>
      </section>
      <LoadingSkeletonList
        count={4}
        variant="panel"
        label="Loading repair center"
      />
    </main>
  );
}