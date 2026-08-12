'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <section className="panel">
        <h1>Something went wrong</h1>
        <p>
          The request could not be completed. No sensitive details were shown.
        </p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
