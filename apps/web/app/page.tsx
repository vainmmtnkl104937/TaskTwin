export default function HomePage() {
  return (
    <main>
      <section className="landing-card" aria-labelledby="product-name">
        <p className="eyebrow">Local-first browser automation</p>
        <h1 id="product-name">TaskTwin</h1>
        <p className="tagline">Show it once. Review the plan. Run it safely.</p>
        <p className="health" role="status">
          <span aria-hidden="true" />
          Web application is running
        </p>
      </section>
    </main>
  );
}
