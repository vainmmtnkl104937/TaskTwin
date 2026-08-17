interface LoadingSkeletonListProps {
  count?: number;
  variant?: 'card' | 'row' | 'panel';
  label?: string;
}

export function LoadingSkeletonList({
  count = 6,
  variant = 'panel',
  label = 'Loading…',
}: LoadingSkeletonListProps) {
  const items = Array.from({ length: count }, (_, index) => index);
  return (
    <section
      className={`skeleton-list skeleton-list--${variant}`}
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      data-testid="loading-skeleton"
    >
      {items.map((index) => (
        <div className="skeleton-card" key={`skeleton-${index}`}>
          <span className="skeleton-bar skeleton-bar--title" />
          <span className="skeleton-bar skeleton-bar--meta" />
          {variant === 'card' ? (
            <span className="skeleton-bar skeleton-bar--body" />
          ) : null}
        </div>
      ))}
    </section>
  );
}

export function LoadingSkeletonBlock({ label }: { label?: string }) {
  return (
    <div
      className="skeleton-block"
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label={label ?? 'Loading'}
    >
      <span className="skeleton-bar skeleton-bar--title" />
      <span className="skeleton-bar skeleton-bar--body" />
    </div>
  );
}