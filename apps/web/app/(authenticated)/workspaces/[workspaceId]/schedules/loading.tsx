import { LoadingSkeletonList } from '@/components/loading-skeleton';

export default function Loading() {
  return (
    <main className="dashboard-page" aria-busy="true">
      <section className="page-heading">
        <p className="eyebrow">Scheduling</p>
        <h1>Schedules</h1>
        <p className="metadata">Loading schedule definitions and occurrences…</p>
      </section>
      <LoadingSkeletonList
        count={4}
        variant="row"
        label="Loading schedules"
      />
    </main>
  );
}